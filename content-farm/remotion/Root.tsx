import React from "react";
import { Composition } from "remotion";
import type { RenderProps, StoryProps } from "../src/schema.ts";
import { sceneFrames, Short } from "./Short.tsx";
import { DEMO_PROPS, DEMO_STORY_PROPS } from "./demo.ts";
import { beatFrames, StoryVideo } from "./Story.tsx";
import { IG_H, IG_W, IgCard } from "./IgCard.tsx";
import { H, W } from "./theme.ts";

export const Root: React.FC = () => (
  <>
  <Composition
    id="Short"
    component={Short}
    width={W}
    height={H}
    fps={30}
    durationInFrames={300}
    defaultProps={DEMO_PROPS}
    calculateMetadata={({ props }: { props: RenderProps }) => ({
      durationInFrames: props.scenes.reduce((a, s) => a + sceneFrames(s, props.fps), 0),
      fps: props.fps,
    })}
  />
  <Composition
    id="Story"
    component={StoryVideo}
    width={W}
    height={H}
    fps={30}
    durationInFrames={300}
    defaultProps={DEMO_STORY_PROPS}
    calculateMetadata={({ props }: { props: StoryProps }) => ({
      durationInFrames: props.beats.reduce((a, b) => a + beatFrames(b, props.fps), 0),
      fps: props.fps,
    })}
  />
  <Composition
    id="IgCard"
    component={IgCard}
    width={IG_W}
    height={IG_H}
    fps={30}
    durationInFrames={1}
    defaultProps={{ image_src: null, headline: "Не кажи «I am agree»", sub: "I agree — я згоден", handle: "@sealenglishschool" }}
  />
  </>
);
