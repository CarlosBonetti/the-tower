# KayKit characters

What Tower 3D makes its workers of, by Kay Lousberg (www.kaylousberg.com, https://kaylousberg.itch.io/). Every pack is
CC0, its licence beside the files packed from it:

- `adventurers.glb`: the parts of the KayKit Adventurers 1.0 the workers' looks use, on one Rig_Medium skeleton, in
  the four adventurers' atlases, without the clips each character file embeds (`License-Adventurers.txt`).
- `rig_medium.glb`: the clips their poses play, from KayKit Character Animations 1.1, without its mannequin
  (`License-Animations.txt`).
- `medium.glb`: the Rig_Medium characters of KayKit Skeletons 1.1 (`License-Skeletons.txt`) and of the KayKit
  Mystery Monthly Series 5 (the Helpers and the Combat Mech, `License-Series5.txt`), skinned to adventurers.glb's
  joints, with their atlases and colourways.
- `large.glb`: the Series 5's Clanker on his Rig_Large skeleton, with his atlas and its colourway.
- `rig_large.glb`: rig_medium.glb's clips on that skeleton, retargeted by the packer.

Only the parts Tower 3D uses are packed, never a whole pack. All are packed from the packs' own files by
`tsx scripts/tower3d-characters.ts <adventurers> <animations> <skeletons> <series5>`, which takes the parts and clips
`renderers/tower3d/src/contract.ts` names.
