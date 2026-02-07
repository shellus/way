#!/usr/bin/env bash
set -euo pipefail

WAY_DIR="${WAY_DIR:-$(dirname "$(readlink -f "$0")")}"
REMOTE="default"
RESTIC_S3_OPTIONS=()

# 解析 --remote 参数
while [[ $# -gt 0 ]]; do
    case "$1" in
        --remote=*)
            REMOTE="${1#*=}"
            shift
            ;;
        *)
            break
            ;;
    esac
done

# 加载环境变量
load_env() {
    [[ -f "$WAY_DIR/.env" ]] && source "$WAY_DIR/.env" || true
}

# 设置 restic 环境变量
setup_restic_env() {
    local repo_file="$WAY_DIR/repositories.yaml"
    [[ ! -f "$repo_file" ]] && echo "Error: $repo_file not found" && exit 1

    local repo_name="$REMOTE"
    [[ "$repo_name" == "default" ]] && repo_name=$(yq '.default' "$repo_file")

    local repo_type=$(yq ".repositories.$repo_name.type" "$repo_file")

    case "$repo_type" in
        s3)
            local endpoint=$(yq ".repositories.$repo_name.endpoint" "$repo_file")
            local bucket=$(yq ".repositories.$repo_name.bucket" "$repo_file")
            export RESTIC_REPOSITORY="s3:https://$endpoint/$bucket"

            # 读取 s3 options
            local bucket_lookup=$(yq ".repositories.$repo_name.options.bucket_lookup // \"\"" "$repo_file")
            [[ -n "$bucket_lookup" && "$bucket_lookup" != "null" ]] && RESTIC_S3_OPTIONS+=("-o" "s3.bucket-lookup=$bucket_lookup")
            ;;
        local)
            local path=$(yq ".repositories.$repo_name.path" "$repo_file")
            export RESTIC_REPOSITORY="$path"
            ;;
        sftp)
            local host=$(yq ".repositories.$repo_name.host" "$repo_file")
            local path=$(yq ".repositories.$repo_name.path" "$repo_file")
            export RESTIC_REPOSITORY="sftp:$host:$path"
            ;;
        *)
            echo "Error: Unknown repository type: $repo_type"
            exit 1
            ;;
    esac

    # 展开凭证
    local password=$(yq ".repositories.$repo_name.credentials.password" "$repo_file")
    local access_key=$(yq ".repositories.$repo_name.credentials.access_key_id" "$repo_file")
    local secret_key=$(yq ".repositories.$repo_name.credentials.secret_access_key" "$repo_file")

    # 展开 ${VAR} 语法
    [[ "$password" =~ ^\$\{(.+)\}$ ]] && password="${!BASH_REMATCH[1]:-}"
    [[ "$access_key" =~ ^\$\{(.+)\}$ ]] && access_key="${!BASH_REMATCH[1]:-}"
    [[ "$secret_key" =~ ^\$\{(.+)\}$ ]] && secret_key="${!BASH_REMATCH[1]:-}"

    [[ -n "$password" && "$password" != "null" ]] && export RESTIC_PASSWORD="$password" || true
    [[ -n "$access_key" && "$access_key" != "null" ]] && export AWS_ACCESS_KEY_ID="$access_key" || true
    [[ -n "$secret_key" && "$secret_key" != "null" ]] && export AWS_SECRET_ACCESS_KEY="$secret_key" || true
}

load_env
setup_restic_env

# run 命令：执行备份
cmd_run() {
    local rules_file="$WAY_DIR/rules.yaml"
    [[ ! -f "$rules_file" ]] && echo "Error: $rules_file not found" && exit 1

    local target_project=""
    local extra_args=()

    # 解析参数：非 -- 开头的第一个参数是项目名，其余都是 restic 参数
    for arg in "$@"; do
        if [[ -z "$target_project" && ! "$arg" =~ ^-- ]]; then
            target_project="$arg"
        else
            extra_args+=("$arg")
        fi
    done

    # 获取项目列表
    local projects
    if [[ -n "$target_project" ]]; then
        projects="$target_project"
    else
        projects=$(yq '.projects | keys | .[]' "$rules_file")
    fi

    local failed=()
    local succeeded=()

    for project in $projects; do
        echo "=== Backing up: $project ==="

        # 构建排除参数
        local excludes=()

        # global_excludes
        while IFS= read -r exclude; do
            [[ -n "$exclude" && "$exclude" != "null" ]] && excludes+=("--exclude=$exclude")
        done < <(yq '.global_excludes[]' "$rules_file" 2>/dev/null || true)

        # project excludes
        while IFS= read -r exclude; do
            [[ -n "$exclude" && "$exclude" != "null" ]] && excludes+=("--exclude=$exclude")
        done < <(yq ".projects.$project.excludes[]" "$rules_file" 2>/dev/null || true)

        # 获取路径
        local paths=()
        while IFS= read -r path; do
            [[ -n "$path" && "$path" != "null" ]] && paths+=("$path")
        done < <(yq ".projects.$project.paths[]" "$rules_file")

        if [[ ${#paths[@]} -eq 0 ]]; then
            echo "Warning: No paths for project $project, skipping"
            continue
        fi

        # 执行备份
        if restic "${RESTIC_S3_OPTIONS[@]}" backup --tag="way:$project" "${excludes[@]}" "${extra_args[@]}" "${paths[@]}"; then
            succeeded+=("$project")
        else
            failed+=("$project")
        fi

        echo ""
    done

    # 汇报结果
    echo "=== Summary ==="
    [[ ${#succeeded[@]} -gt 0 ]] && echo "Succeeded: ${succeeded[*]}"
    [[ ${#failed[@]} -gt 0 ]] && echo "Failed: ${failed[*]}"

    [[ ${#failed[@]} -gt 0 ]] && exit 1
    exit 0
}

# gc 命令：按策略清理快照
cmd_gc() {
    local rules_file="$WAY_DIR/rules.yaml"
    [[ ! -f "$rules_file" ]] && echo "Error: $rules_file not found" && exit 1

    local keep_daily=$(yq '.retention.keep_daily // 7' "$rules_file")
    local keep_weekly=$(yq '.retention.keep_weekly // 4' "$rules_file")
    local keep_monthly=$(yq '.retention.keep_monthly // 6' "$rules_file")

    echo "=== Cleaning snapshots ==="
    echo "Policy: daily=$keep_daily, weekly=$keep_weekly, monthly=$keep_monthly"

    restic "${RESTIC_S3_OPTIONS[@]}" forget --prune \
        --keep-daily="$keep_daily" \
        --keep-weekly="$keep_weekly" \
        --keep-monthly="$keep_monthly" \
        "$@"
}

# cron 命令：管理定时任务
cmd_cron() {
    local subcmd="${1:-show}"
    local rules_file="$WAY_DIR/rules.yaml"
    [[ ! -f "$rules_file" ]] && echo "Error: $rules_file not found" && exit 1

    local marker_start="# === way backup schedule ==="
    local marker_end="# === way backup schedule end ==="

    generate_cron() {
        echo "$marker_start"

        # backup schedules
        while IFS= read -r cron; do
            [[ -n "$cron" && "$cron" != "null" ]] && echo "$cron /usr/local/bin/way run"
        done < <(yq '.schedule.backup[]' "$rules_file" 2>/dev/null || true)

        # prune schedule
        local prune=$(yq '.schedule.prune // ""' "$rules_file")
        [[ -n "$prune" && "$prune" != "null" && "$prune" != "" ]] && echo "$prune /usr/local/bin/way gc"

        # check schedule
        local check=$(yq '.schedule.check // ""' "$rules_file")
        [[ -n "$check" && "$check" != "null" && "$check" != "" ]] && echo "$check /usr/local/bin/way check"

        echo "$marker_end"
    }

    case "$subcmd" in
        show)
            generate_cron
            ;;
        install)
            # 获取现有 crontab，移除旧的 way 条目
            local existing
            existing=$(crontab -l 2>/dev/null | sed "/$marker_start/,/$marker_end/d" || true)

            # 合并新条目
            {
                echo "$existing"
                generate_cron
            } | crontab -

            echo "Crontab installed successfully"
            crontab -l | grep -A100 "$marker_start" | head -20
            ;;
        *)
            echo "Usage: way cron [show|install]"
            exit 1
            ;;
    esac
}

# env 命令：显示所有环境变量
cmd_env() {
    env | sort
}

# 主命令分发
CMD="${1:-}"
case "$CMD" in
    run)
        shift
        cmd_run "$@"
        ;;
    gc)
        shift
        cmd_gc "$@"
        ;;
    env)
        cmd_env
        ;;
    cron)
        shift
        cmd_cron "$@"
        ;;
    "")
        echo "Usage: way [--remote=name] <command> [args...]"
        echo "Commands: run, gc, cron, or any restic command"
        ;;
    *)
        # 透传给 restic
        exec restic "${RESTIC_S3_OPTIONS[@]}" "$@"
        ;;
esac
