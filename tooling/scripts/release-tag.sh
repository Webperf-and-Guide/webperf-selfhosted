#!/usr/bin/env bash

set -euo pipefail

mode="${1:-}"
tag="${2:-}"
source_sha="${3:-}"
version="${4:-}"
script_directory="$(
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1
  pwd -P
)"
repository_root="$(
  cd -- "${script_directory}/../.." >/dev/null 2>&1
  pwd -P
)"

case "$mode" in
  verify|publish)
    ;;
  *)
    echo 'Usage: release-tag.sh <verify|publish> <tag> <source-sha> <version>' >&2
    exit 1
    ;;
esac

validator="${repository_root}/tooling/scripts/release-bundle.ts"
if [[ "$tag" != "v${version}" ]]; then
  echo 'Release tag does not match the requested version.' >&2
  exit 1
fi
if ! command -v bun >/dev/null 2>&1 || [[ ! -f "$validator" ]]; then
  echo 'Release version validator tooling is unavailable.' >&2
  exit 1
fi
if ! bun "$validator" validate-version "$version" >/dev/null; then
  echo 'Release version validation failed.' >&2
  exit 1
fi
if [[ ! "$source_sha" =~ ^[a-f0-9]{40}$ ]]; then
  echo 'Release source must be a full Git commit SHA.' >&2
  exit 1
fi

tag_ref="refs/tags/${tag}"

verify_remote_tag() {
  local remote_refs
  local remote_status
  local remote_tag_object
  local remote_source

  remote_refs=''
  remote_status=0
  remote_refs="$(
    git ls-remote --exit-code --tags origin "$tag_ref" "${tag_ref}^{}" 2>/dev/null
  )" || remote_status=$?
  if [[ "$remote_status" -eq 2 ]]; then
    return 2
  fi
  if [[ "$remote_status" -ne 0 ]]; then
    echo 'Unable to inspect the existing release tag.' >&2
    return 1
  fi

  remote_tag_object="$(
    awk -v ref="$tag_ref" '$2 == ref { print $1 }' <<<"$remote_refs"
  )"
  remote_source="$(
    awk -v ref="${tag_ref}^{}" '$2 == ref { print $1 }' <<<"$remote_refs"
  )"
  if [[ -z "$remote_tag_object" || -z "$remote_source" ]]; then
    echo 'Existing release tag must be annotated.' >&2
    return 1
  fi
  if [[ "$remote_source" != "$source_sha" ]]; then
    echo 'Existing release tag points to a different source commit.' >&2
    return 1
  fi
  return 0
}

remote_status=0
verify_remote_tag || remote_status=$?
if [[ "$remote_status" -eq 0 ]]; then
  exit 0
fi
if [[ "$remote_status" -ne 2 ]]; then
  exit "$remote_status"
fi

if [[ "$mode" = 'verify' ]]; then
  exit 0
fi

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git tag -a -f "$tag" "$source_sha" -m "WebPerf ${version}"
# A GITHUB_TOKEN-authored tag push does not recursively start the release workflow.
if git push origin "$tag_ref"; then
  exit 0
fi

# A concurrent release may have won the push race. Treat it as success only
# when the remote annotated tag resolves to the same immutable source commit.
remote_status=0
verify_remote_tag || remote_status=$?
if [[ "$remote_status" -eq 0 ]]; then
  exit 0
fi
echo 'Release tag publication failed and no matching remote tag exists.' >&2
exit 1
