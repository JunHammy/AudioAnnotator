import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

/**
 * Dark-first theme using a neutral charcoal palette (Mantine-inspired).
 * Not pure black — warm dark grays that are easy on the eyes.
 *
 * bg       #1a1b1e  page background
 * bg.subtle  #25262b  cards, panels
 * bg.muted   #2c2e33  inputs, hover states
 * fg         #c1c2c5  primary text
 * fg.muted   #909296  secondary text
 * border     #373a40  subtle borders
 */
const config = defineConfig({
  theme: {
    tokens: {
      colors: {
        brand: {
          50: { value: "#e3f2fd" },
          500: { value: "#2196f3" },
          600: { value: "#1e88e5" },
          700: { value: "#1976d2" },
        },
      },
    },
    semanticTokens: {
      colors: {
        bg: {
          DEFAULT: { value: { _dark: "#1a1b1e", _light: "#f8f9fa" } },
          subtle: { value: { _dark: "#25262b", _light: "#ffffff" } },
          muted: { value: { _dark: "#2c2e33", _light: "#e9ecef" } },
        },
        fg: {
          DEFAULT: { value: { _dark: "#c1c2c5", _light: "#212529" } },
          muted: { value: { _dark: "#909296", _light: "#868e96" } },
        },
        border: {
          DEFAULT: { value: { _dark: "#373a40", _light: "#dee2e6" } },
          subtle: { value: { _dark: "#2c2e33", _light: "#e9ecef" } },
        },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);
