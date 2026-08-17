export const INITIAL_COMPOSITION_FIXTURE = `X:1
T:Untitled
M:4/4
L:1/4
Q:1/4=120
K:C
V:track.drums
V:track.bass
V:track.guitar
V:track.keys
V:track.strings
V:track.winds
[V:track.drums] z4 |
[V:track.bass] z4 |
[V:track.guitar] z4 |
[V:track.keys] z4 |
[V:track.strings] z4 |
[V:track.winds] z4 |
`;

export const createInitialComposition = (): string =>
  INITIAL_COMPOSITION_FIXTURE;
