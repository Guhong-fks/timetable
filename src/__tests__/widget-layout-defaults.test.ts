type FsLike = { readFileSync: (path: string, encoding: string) => string };
type PathLike = { resolve: (...parts: string[]) => string };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeFs = require('fs') as FsLike;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodePath = require('path') as PathLike;
const layout = nodeFs.readFileSync(
  nodePath.resolve(
    // @ts-expect-error Node's __dirname is hidden by tsconfig types:["jest"]
    __dirname,
    '..',
    '..',
    'widgets',
    'src',
    'res',
    'layout',
    'widget_timetable.xml',
  ),
  'utf8',
);

function viewTag(id: string): string {
  const marker = `android:id="@+id/${id}"`;
  const index = layout.indexOf(marker);
  if (index < 0) return '';
  return layout.slice(layout.lastIndexOf('<', index), layout.indexOf('>', index) + 1);
}

describe('timetable widget initial layout', () => {
  it('shows an empty state instead of blank course cards before provider data arrives', () => {
    expect(viewTag('empty_container')).toContain('android:visibility="visible"');
    expect(viewTag('course1_container')).toContain('android:visibility="gone"');
    expect(viewTag('course2_container')).toContain('android:visibility="gone"');
  });
});
