# Music Harness — product context

## Product

Music Harness is a local-first Windows music workstation. It helps a musician listen to
the saved **Current**, shape a coherent six-track arrangement, and ask an agent
for musical changes without silently overwriting their work.

## Who it is for

A musician or producer who wants a focused creative surface, not a MIDI editor
or an agent control centre. They need to understand the whole arrangement at a
glance, audition it safely, and retain control over every consequential change.

## P0 outcome

Open a project, hear Current, see and control all six logical tracks together,
and send a natural-language request. A staged Candidate is reviewed in the
main workspace, separately from the conversation, before it can be applied.

## Product truths and constraints

- Current is authoritative and safe; a Candidate is staged until explicitly
  applied.
- Playback, mute, solo, Current/Candidate preview and Candidate resolution are
  real P0 interactions.
- This is not a MIDI note editor in P0. Do not expose decorative piano-roll
  strips or imply direct note editing.
- Scope selection and advanced sound-shaping controls are P1; do not make them
  the centre of the P0 experience.
- The Renderer is an Electron desktop surface. Its primary use is a wide,
  dark, low-distraction studio environment.

## Direction

Calm Apple-grade material restraint with the warmth and creative directness of
a modern AI music product: near-black surfaces, soft dimensional depth, one
violet-to-rose creative accent, crisp system typography, and a clear hierarchy
between music, transport, conversation, and safe review.

## Source

This context records the explicit UI direction and P0/P1 decisions supplied by
the product owner on 2026-09-09, plus the repository's Current/Candidate
contracts.
