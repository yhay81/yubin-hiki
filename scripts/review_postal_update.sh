#!/usr/bin/env bash
set -euo pipefail

branch=automation/postal-data
ref="refs/heads/$branch"
paths=(data/source/utf_ken_all.zip src/generated/postal-meta.json public/sitemap.xml public/sitemaps)

git add -- "${paths[@]}"
if git diff --cached --quiet; then
  echo "Postal data is current" >> "$GITHUB_STEP_SUMMARY"
  exit 0
fi

remote=$(git ls-remote --heads origin "$ref")
previous=${remote%%[[:space:]]*}
if [[ -n "$previous" ]]; then
  git fetch --no-tags origin "$ref"
  previous=$(git rev-parse FETCH_HEAD)
fi
if [[ -z "$previous" ]] || ! git diff --cached --quiet "$previous" -- "${paths[@]}"; then
  git config user.name 'github-actions[bot]'
  git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
  git commit -m "Update Japan Post postal data"
  git push --force-with-lease="$ref:$previous" origin "HEAD:$ref"
fi

url=$(gh pr list --base main --head "$branch" --state open --json url,isCrossRepository \
  --jq 'map(select(.isCrossRepository == false))[0].url // empty')
if [[ -z "$url" ]]; then
  if result=$(gh pr create --base main --head "$branch" --title "Update Japan Post postal data" \
    --body "Weekly refresh from Japan Post's official UTF-8 national postal-code archive. Review the archive digest, counts and generated sitemap changes before merging." 2>&1); then
    url=$result
  elif [[ "$result" == *"GitHub Actions is not permitted to create or approve pull requests"* ]]; then
    url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/compare/main...$branch?expand=1"
    echo "::warning::Verified postal data is ready. Open the review pull request: $url"
    echo "The repository requires a person to open the pull request. [Review the verified postal update]($url)." >> "$GITHUB_STEP_SUMMARY"
    exit 0
  else
    echo "$result" >&2
    exit 1
  fi
fi
echo "[Review the postal update]($url)." >> "$GITHUB_STEP_SUMMARY"
