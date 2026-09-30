import React from 'react';
import {Composition, registerRoot} from 'remotion';
import {DecisionLoopFilm} from './Film';

const Root = () => <Composition id="DecisionLoop" component={DecisionLoopFilm} durationInFrames={864} fps={24} width={1920} height={1080}/>;
registerRoot(Root);
