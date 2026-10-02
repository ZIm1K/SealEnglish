import { loadFont as loadOnest } from "@remotion/google-fonts/Onest";
import { loadFont as loadUnbounded } from "@remotion/google-fonts/Unbounded";

export const display = loadUnbounded("normal", { weights: ["700", "900"], subsets: ["cyrillic", "latin"] }).fontFamily;
export const body = loadOnest("normal", { weights: ["600", "800"], subsets: ["cyrillic", "latin"] }).fontFamily;

export const C = {
  sky: "#8CC1F2",
  skyDeep: "#4C93DB",
  navy: "#061428",
  navy2: "#0D2448",
  coral: "#FB7B63",
  white: "#FFFFFF",
  green: "#3DDC97",
  red: "#FF5A5F",
};

export const W = 1080;
export const H = 1920;
