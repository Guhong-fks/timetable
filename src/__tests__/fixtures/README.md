# Recognition Fixtures

Golden fixtures for `src/__tests__/recognizer.golden.test.ts` — real
university timetable exports converted to the DeviceIR shape that
`react-native-anydoc` v0.4.1 emits (Origin cells only, vMerge-continue
slots skipped, column implied by array order).

| File | Source | Dialect |
|---|---|---|
| `ahau.json` | 安徽大学教务导出（《我的课表.docx》） | one vMerge cell per course; name/code/(weeks)(periods)campus room teacher(s)/class paragraphs; two courses stacked in one cell |
| `cjlu.json` | 中国计量大学正方导出（《课表.docx》） | name in a vMerge cell, details hard-wrapped across SEPARATE cells below, weeks OUTSIDE parens, table split across two pages |

## Regenerating / adding a school

```bash
# 1. Dump the .docx grid to anchor form (row/col/rowSpan/colSpan/text):
python scripts/dump_docx_grid.py <新学校课表.docx> --json fixture_new.json

# 2. Convert anchors to the device IR shape and copy into __tests__/fixtures/:
python - <<'EOF'
import json

def to_device_ir(tables):
    out = []
    for anchors in tables:
        max_row = max(a['rowIndex'] + a['rowSpan'] for a in anchors)
        max_col = max(a['colIndex'] + a['colSpan'] for a in anchors)
        slots = [[None] * max_col for _ in range(max_row)]
        for a in anchors:
            for r in range(a['rowIndex'], a['rowIndex'] + a['rowSpan']):
                for c in range(a['colIndex'], a['colIndex'] + a['colSpan']):
                    slots[r][c] = a
        rows = []
        for r in range(max_row):
            row = []
            for c in range(max_col):
                a = slots[r][c]
                if a is None or not (a['rowIndex'] == r and a['colIndex'] == c):
                    continue  # Covered slot — anydoc skips it
                row.append({
                    'paragraphs': [[{'text': t}] for t in a['text']],
                    'rowSpan': a['rowSpan'],
                    'colSpan': a['colSpan'],
                })
            rows.append(row)
        out.append({'type': 'table', 'rows': rows})
    return out

tables = json.load(open('fixture_new.json', encoding='utf-8'))
json.dump(to_device_ir(tables), open('src/__tests__/fixtures/new_school.json', 'w', encoding='utf-8'), ensure_ascii=False)
EOF

# 3. Add assertions to recognizer.golden.test.ts pinning the expected
#    course count and fields, then extend the cellReader dialect rules
#    until the test passes.
```

> The standalone Python recognizer prototype (`recognize.py`) used to iterate
> on dialect rules lives OUTSIDE the repo (the sibling `analysis/` folder) —
> keep exploration prototypes out of the committed tree.
