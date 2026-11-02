const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['.expo/', '.agents/', 'dist/', 'android/', 'ios/'],
  },
  {
    // SDK 57's react-hooks preset ships the new React Compiler rules at error.
    // Two of them flag patterns this app relies on everywhere — `useRef(new
    // Animated.Value(…)).current` for RN animations and effects that re-seed
    // local state when an async store value lands. Rewriting those blind is a
    // bigger risk than the render they prevent, so they report as warnings
    // until the screens they point at are touched on purpose.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
]);
