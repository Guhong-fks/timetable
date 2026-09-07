/**
 * Empty stub for `react-native-nitro-modules` in Jest. The real module
 * pulls in JSI bindings which aren't available in a Node environment.
 */
export const NitroModules = {
  createHybridObject: (): never => {
    throw new Error('[jest stub] NitroModules.createHybridObject called in tests.');
  },
};