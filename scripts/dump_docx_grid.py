# -*- coding: utf-8 -*-
"""Dump the full table structure of a .docx with correct OOXML grid resolution.

Handles: gridSpan, vMerge (restart/continue), nested tables, bold runs.
Produces anchor entries identical in spirit to react-native-anydoc's IR:
(row, col, rowSpan, colSpan, paragraphs[{text, bold}]).

Usage: python dump_docx_grid.py <file.docx> [--json out.json]
"""
import sys, json, zipfile
import xml.etree.ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

def runs_of(p):
    """[(text, bold)] for one paragraph element."""
    out = []
    for r in p.iter(W + 'r'):
        bold = False
        rpr = r.find(W + 'rPr')
        if rpr is not None:
            b = rpr.find(W + 'b')
            if b is not None and b.get(W + 'val', '1') not in ('0', 'false'):
                bold = True
        t = ''.join(t.text or '' for t in r.iter(W + 't'))
        if t:
            out.append((t, bold))
    return out

def paras_of_tc(tc):
    """Paragraphs directly inside this tc, plus flags for nested tables."""
    paras, nested = [], []
    for child in tc:
        if child.tag == W + 'p':
            rs = runs_of(child)
            if rs:
                paras.append({'text': ''.join(t for t, _ in rs),
                              'bold': any(b for _, b in rs)})
        elif child.tag == W + 'tbl':
            nested.append(child)
    return paras, nested

def dump_table(tbl, depth=0, out=None):
    """Resolve one <w:tbl> into anchor cells. Returns list of anchors, each
    with optional 'nested' tables dumped recursively."""
    rows = tbl.findall(W + 'tr')
    width = 0
    for tr in rows:
        w = 0
        for tc in tr.findall(W + 'tc'):
            tcpr = tc.find(W + 'tcPr')
            gs = 1
            if tcpr is not None:
                g = tcpr.find(W + 'gridSpan')
                if g is not None:
                    gs = int(g.get(W + 'val'))
            w += gs
        width = max(width, w)

    occupied = [[False] * width for _ in rows]
    open_merges = {}   # col -> {'anchor': anchor, 'rowEnd': last row seen}
    anchors = []

    for ri, tr in enumerate(rows):
        col = 0
        for tc in tr.findall(W + 'tc'):
            tcpr = tc.find(W + 'tcPr')
            gridspan, vmerge = 1, None
            if tcpr is not None:
                g = tcpr.find(W + 'gridSpan')
                if g is not None:
                    gridspan = int(g.get(W + 'val'))
                vm = tcpr.find(W + 'vMerge')
                if vm is not None:
                    vmerge = vm.get(W + 'val', 'continue')

            # skip columns occupied by prior colSpans
            while col < width and occupied[ri][col]:
                col += 1
            if col >= width:
                break

            if vmerge == 'continue':
                op = open_merges.get(col)
                if op is not None:
                    op['anchor']['rowSpan'] = ri + 1 - op['anchor']['rowIndex']
                    op['lastRow'] = ri
                else:
                    # orphan continue: treat as empty occupied cell
                    for cc in range(col, min(col + gridspan, width)):
                        occupied[ri][cc] = True
                col += gridspan
                continue

            paras, nested_tcs = paras_of_tc(tc)
            anchor = {
                'rowIndex': ri, 'colIndex': col,
                'rowSpan': 1, 'colSpan': gridspan,
                'text': [p['text'] for p in paras],
                'bold': [p['bold'] for p in paras],
                'depth': depth,
            }
            if nested_tcs:
                anchor['nested'] = []
                for nt in nested_tcs:
                    anchor['nested'].extend(dump_table(nt, depth + 1))
            anchors.append(anchor)

            if vmerge == 'restart':
                open_merges[col] = {'anchor': anchor, 'lastRow': ri}

            # mark the current row's columns occupied (colSpan); rows below
            # are consumed via their own vMerge-continue cells.
            for cc in range(col, min(col + gridspan, width)):
                occupied[ri][cc] = True
            col += gridspan

    return anchors

def dump(path):
    with zipfile.ZipFile(path) as z:
        xml = z.read('word/document.xml')
    root = ET.fromstring(xml)
    body = root.find(W + 'body')
    tables = []
    for tbl in body.iter(W + 'tbl'):
        # only top-level tables (depth 0): those whose nearest tbl ancestor is body
        tables.append(tbl)
    top = [t for t in tables if t.getparent() is None] if hasattr(tables[0], 'getparent') else tables
    # ElementTree has no getparent; collect top-level by walking body children
    top = []
    def walk(el):
        for child in el:
            if child.tag == W + 'tbl':
                top.append(child)
            elif child.tag == W + 'p':
                continue
            else:
                walk(child)
    walk(body)
    result = []
    for t in top:
        result.append(dump_table(t, 0))
    return result

def render(anchors, indent=0):
    lines = []
    for a in anchors:
        pad = '  ' * (indent + a.get('depth', 0))
        flags = []
        if a['rowSpan'] > 1: flags.append(f"rowSpan={a['rowSpan']}")
        if a['colSpan'] > 1: flags.append(f"colSpan={a['colSpan']}")
        fl = (' [' + ','.join(flags) + ']') if flags else ''
        b = '(B)' if any(a['bold']) else ''
        t = ' | '.join(a['text'])
        lines.append(f"{pad}r{a['rowIndex']} c{a['colIndex']}{fl}{b}: {t!r}")
        for sub in a.get('nested', []):
            lines.append(f"{pad}  ┌─ nested:")
            lines.extend(render([sub], indent + 2))
    return lines

if __name__ == '__main__':
    path = sys.argv[1]
    tables = dump(path)
    for ti, anchors in enumerate(tables):
        print(f'=== TABLE {ti}: {len(anchors)} anchor cells ===')
        print('\n'.join(render(anchors)))
    if '--json' in sys.argv:
        outpath = sys.argv[sys.argv.index('--json') + 1]
        with open(outpath, 'w', encoding='utf-8') as f:
            json.dump(tables, f, ensure_ascii=False, indent=1)
        print(f'-> {outpath}')
