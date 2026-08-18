#!/usr/bin/env python3
"""Move GitHub Project V2 board items between Status columns.

Quirks handled (see references/github-projects-graphql-api.md):
- singleSelectOptionId GraphQL variable type is String!, not ID!
- fieldValues.nodes[].field is a union, requires inline ... on ProjectV2FieldCommon
- Some items return empty fieldValues[] (REST-created without defaults)
- updateProjectV2Field replaces all options; preserve existing IDs by passing them back

Usage:
    python3 scripts/move-board.py                       # List all items + current status
    python3 scripts/move-board.py <num> <lane>          # Move ticket #N to LANE
    python3 scripts/move-board.py 1 in_qa               # Example
    python3 scripts/move-board.py 7 done                # Example
    python3 scripts/move-board.py add-option <name>     # Append a new Status option

4-lane board (Todo, In Progress, In QA, Done) for SpendFlow Board (arkinara/spendflow).
"""
import urllib.request, urllib.error, json, subprocess
import sys

# ---- Configuration ----
PROJECT_ID = 'PVT_kwHOEL4FrM4BesaS'                     # arkinara/spendflow "SpendFlow Board"
STATUS_FIELD_ID = 'PVTSSF_lAHOEL4FrM4BesaSzhZEtJU'      # "Status" single-select field

LANES = {
    'todo':        'f75ad846',
    'in_progress': '47fc9ee4',
    'in_qa':       '379bfbc0',
    'done':        '98236657',
}


def _token():
    r = subprocess.run(['gh', 'auth', 'token'], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit('gh auth token failed: ' + r.stderr)
    return r.stdout.strip()


def gql(query, variables=None):
    req = urllib.request.Request(
        'https://api.github.com/graphql',
        data=json.dumps({'query': query, 'variables': variables or {}}).encode(),
        headers={
            'Authorization': 'Bearer ' + _token(),
            'Content-Type': 'application/json',
        },
        method='POST')
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def list_items():
    """Return all items in the project with current Status (or 'unset')."""
    q = '''{
      node(id: "%s") {
        ... on ProjectV2 {
          items(first: 100) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              content { ... on Issue { number title state } }
              fieldValues(first: 10) {
                nodes {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    optionId
                    field { ... on ProjectV2FieldCommon { id } }
                  }
                }
              }
            }
          }
        }
      }
    }''' % PROJECT_ID
    items = []
    while True:
        raw = gql(q)
        batch = (raw.get("data", {}).get("node", {})
                 .get("items", {}).get("nodes", []))
        items.extend(batch)
        page = (raw.get("data", {}).get("node", {})
                .get("items", {}).get("pageInfo", {}))
        if not page.get("hasNextPage"):
            break
        # Re-issue with cursor
        cursor = page.get("endCursor")
        q_paged = q.replace(
            "items(first: 100) {",
            f"items(first: 100, after: \"{cursor}\") {{",
        )
        q = q_paged
    data = items
    opt_to_name = {v: k for k, v in LANES.items()}
    rows = []
    for it in data:
        n = it['content'].get('number', '?')
        t = it['content'].get('title', '?')
        st = 'unset'
        for fv in (it.get('fieldValues') or {}).get('nodes') or []:
            f = fv.get('field') or {}
            if f.get('id') == STATUS_FIELD_ID:
                oid = fv.get('optionId') or '?'
                st = opt_to_name.get(oid, oid)
        rows.append((n, t, st, it['id']))
    return rows


def move_status(item_id, option_id, label='moving'):
    """Move an item to a single-select Status column. Returns True/False."""
    mutation = '''mutation($p: ID!, $i: ID!, $f: ID!, $o: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $p, itemId: $i, fieldId: $f,
        value: { singleSelectOptionId: $o }
      }) { projectV2Item { id } }
    }'''  # NOTE: $o is String!, not ID!.
    result = gql(mutation, {'p': PROJECT_ID, 'i': item_id, 'f': STATUS_FIELD_ID, 'o': option_id})
    if 'errors' in result:
        print(f'  ERR: {result["errors"][0]["message"]}')
        return False
    print(f'  -> {label} OK')
    return True


def add_lane_option(name):
    """Append a new option to the Status field. Preserve existing IDs."""
    mutation = '''mutation($f: ID!, $opts: [ProjectV2SingleSelectFieldOptionInput!]!) {
  updateProjectV2Field(input: {
    fieldId: $f,
    singleSelectOptions: $opts
  }) {
    projectV2Field {
      ... on ProjectV2SingleSelectField { options { id name color } }
    }
  }
}'''
    q = '{ node(id: "%s") { ... on ProjectV2SingleSelectField { options { id name color } } } }' % STATUS_FIELD_ID
    existing = gql(q)['data']['node']['options']
    new_opts = [{'id': o['id'], 'name': o['name'], 'color': o['color']} for o in existing]
    new_opts.append({'name': name, 'color': 'BLUE', 'description': ''})
    result = gql(mutation, {'f': STATUS_FIELD_ID, 'opts': new_opts})
    if 'errors' in result:
        print(f'  ERR: {result["errors"][0]["message"]}')
        return False
    print(f'  -> added option "{name}" OK')
    return True


def main():
    args = sys.argv[1:]
    items = list_items()

    if not args:
        # Default: list all items + current lane
        print(f'=== Project {PROJECT_ID} — {len(items)} items')
        print(f'    lanes: {", ".join(LANES)}')
        for n, t, st, _ in sorted(items):
            print(f'  #{n:>3} [{st:12}] {t[:60]}')
        return

    if len(args) >= 2 and args[0] == 'add-option':
        add_lane_option(args[1])
        return

    if len(args) != 2:
        print(__doc__)
        sys.exit(1)

    # args: <issue_number> <lane>
    try:
        issue_num = int(args[0])
    except ValueError:
        print(f'Issue number required (got {args[0]!r})')
        sys.exit(1)
    lane = args[1].lower()
    if lane not in LANES:
        print(f'Lane must be one of: {", ".join(LANES)}')
        sys.exit(1)
    option_id = LANES[lane]

    item_id = None
    for n, _, _, iid in items:
        if n == issue_num:
            item_id = iid
            break
    if not item_id:
        print(f'Issue #{issue_num} not found in project')
        sys.exit(1)

    print(f'Issue #{issue_num} -> {lane}')
    move_status(item_id, option_id, label=lane)


if __name__ == '__main__':
    main()
