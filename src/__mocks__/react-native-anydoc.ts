/**
 * Empty stub for `react-native-anydoc` in Jest. Replaces the real module
 * which would otherwise try to resolve Nitro's native bridge.
 *
 * Tests must never call `convertDocumentToIr()` — the IR shapes are
 * constructed directly in the test files instead.
 */
export const convertDocumentToIr = (): Promise<never> => {
  throw new Error(
    '[jest stub] convertDocumentToIr was called in a test. ' +
      'Construct a fake IR shape inline instead.',
  );
};
