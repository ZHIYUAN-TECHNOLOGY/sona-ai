import type { ImageSource } from "expo-image";

/** Add only an appropriately licensed, deidentified teaching image with provenance. */
export type TeachingImage = {
  id: string;
  source: ImageSource | number;
  title: string;
  attribution: string;
  license: string;
  sourceUrl: string;
  referenceSummary?: string;
};

export const teachingImage: TeachingImage | undefined = {
  id: "commons-normal-pa-2017",
  source: require("./assets/normal-pa-chest.jpg"),
  title: "PA chest · reference example",
  attribution: "Mikael Häggström · Wikimedia Commons · 2017",
  license: "CC0 1.0",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Normal_posteroanterior_(PA)_chest_radiograph_(X-ray).jpg",
  referenceSummary: "The uploader describes a normal chest with no signs of injury.",
};
