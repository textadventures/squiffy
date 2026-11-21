# Changelog

## [7.0.0-beta.9](https://github.com/textadventures/squiffy/compare/v7.0.0-beta.8...v7.0.0-beta.9) (2026-11-21)


### Features

* a new Find and Replace panel and Go to line bar in the editor ([#533](https://github.com/textadventures/squiffy/issues/533)) ([7586979](https://github.com/textadventures/squiffy/commit/75869797114ebdeeda4cf4eb960426b9281db634))
* collapsible folders in the editor's files list, with the build folder collapsed ([#531](https://github.com/textadventures/squiffy/issues/531)) ([3a9a9a5](https://github.com/textadventures/squiffy/commit/3a9a9a53c6cd377f1f848c272ebc769993af5dc1))
* delete, add passages and undo from the story map, with new sections placed after their parent ([#543](https://github.com/textadventures/squiffy/issues/543)) ([95a3e65](https://github.com/textadventures/squiffy/commit/95a3e65ed3600b887da1d3825722a1734aa73173))
* Find in Files in the editor ([#534](https://github.com/textadventures/squiffy/issues/534)) ([36a4ef9](https://github.com/textadventures/squiffy/commit/36a4ef9615083d905183d82e7f1d6d3c5ad91455))
* Replace in Files in the editor ([#536](https://github.com/textadventures/squiffy/issues/536)) ([4045959](https://github.com/textadventures/squiffy/commit/4045959fd9a1f602a4a510f6ad814a088265889d))
* write a section beside the full-screen story map ([#544](https://github.com/textadventures/squiffy/issues/544)) ([fa362b7](https://github.com/textadventures/squiffy/commit/fa362b7a8487abb787cb3595b7699d160d969e01))

## [7.0.0-beta.8](https://github.com/textadventures/squiffy/compare/v7.0.0-beta.7...v7.0.0-beta.8) (2026-11-21)


### Features

* --check and the editor report Handlebars syntax errors in a section's text ([#507](https://github.com/textadventures/squiffy/issues/507)) ([ff894c0](https://github.com/textadventures/squiffy/commit/ff894c0ded634fcb043bc1d21b09fed0668e09e6))
* [@leave](https://github.com/leave) for how the old text goes when the screen is cleared ([#497](https://github.com/textadventures/squiffy/issues/497)) ([2383edb](https://github.com/textadventures/squiffy/commit/2383edb66b26b178bcb7c09e41f6b992f7c9e094))
* [@transition](https://github.com/transition) for how a section or passage appears ([#492](https://github.com/textadventures/squiffy/issues/492)) ([bf01dd3](https://github.com/textadventures/squiffy/commit/bf01dd34919241408af8fd253700f2c75eadbdd1))
* {{#every}} and {{stop}}, for text shown again and again ([#481](https://github.com/textadventures/squiffy/issues/481)) ([a7b8749](https://github.com/textadventures/squiffy/commit/a7b8749ceeea7b661b87cf4ca176c6723655ee1e))
* {{#once}} shows its text the first time only ([#522](https://github.com/textadventures/squiffy/issues/522)) ([2e18c50](https://github.com/textadventures/squiffy/commit/2e18c50b9ef8fc34169e995a21ab3e9e7f0a2750))
* {{#style}} for styling some text, and built-in text effects ([#488](https://github.com/textadventures/squiffy/issues/488)) ([02b03ca](https://github.com/textadventures/squiffy/commit/02b03ca6f4e2e18fc5dc637985a51d2eb2c32785))
* {{restart}} and {{saves}} links, and a styled restart question ([#485](https://github.com/textadventures/squiffy/issues/485)) ([f69ed82](https://github.com/textadventures/squiffy/commit/f69ed82449bc90e053338795e7bb0558ed9f9170))
* a right-click menu in the editor, and a Keyboard shortcuts dialog ([#496](https://github.com/textadventures/squiffy/issues/496)) ([05f68ac](https://github.com/textadventures/squiffy/commit/05f68acaa1b6926c6c2abf18c775f77011aaf628))
* convert Twine's &lt;&lt;repeat&gt;&gt;, (live:) and timers with delays worked out as the story runs ([#482](https://github.com/textadventures/squiffy/issues/482)) ([ed5a57a](https://github.com/textadventures/squiffy/commit/ed5a57a3a4e8acee7a2fe1a97765ce642c3c3958))
* delays from expressions and times like "3s" in {{goto}} and {{#animate}} ([#480](https://github.com/textadventures/squiffy/issues/480)) ([57a2ecc](https://github.com/textadventures/squiffy/commit/57a2eccdc1b81f0e628db09e96b572dba10c890b))
* Download the app links on squiffystory.com's home page and the editor's ([#502](https://github.com/textadventures/squiffy/issues/502)) ([3f4c9d0](https://github.com/textadventures/squiffy/commit/3f4c9d0d74f727dcc3e84127c14dede854bcd3bd))
* drag editor tabs into another order, and Show in Finder in the desktop app ([#495](https://github.com/textadventures/squiffy/issues/495)) ([8b82f80](https://github.com/textadventures/squiffy/commit/8b82f801ce9985e1dc817b63881ad95a76d567ae))
* player settings, and a {{settings}} link ([#486](https://github.com/textadventures/squiffy/issues/486)) ([f0b6521](https://github.com/textadventures/squiffy/commit/f0b652162858e83034e710ccbd5c19119b29b449))
* playthrough tests in the CLI, with --play --record and --test ([#504](https://github.com/textadventures/squiffy/issues/504)) ([f0803c6](https://github.com/textadventures/squiffy/commit/f0803c6a84ab82e1cf3451aef7d57161f7a34534))
* text boxes that go to a section or passage when Enter is pressed ([#490](https://github.com/textadventures/squiffy/issues/490)) ([46bd204](https://github.com/textadventures/squiffy/commit/46bd204a19b7022ee20923c02a29b331bdc18e4b))
* the editor picks up changes made to a story's files outside it ([#493](https://github.com/textadventures/squiffy/issues/493)) ([284afcd](https://github.com/textadventures/squiffy/commit/284afcd601f99d774c86f8d50e27aeaa65eacff7))
* the editor's home page shows games made with Squiffy ([#509](https://github.com/textadventures/squiffy/issues/509)) ([4bee26b](https://github.com/textadventures/squiffy/commit/4bee26bceed85357cd24a3f00c2a87a84287d423))
* the Twine importer converts Twine's CSS selectors, passage scripts and styles, and range loops over a number ([#498](https://github.com/textadventures/squiffy/issues/498)) ([02268b1](https://github.com/textadventures/squiffy/commit/02268b169927410f5985ec471b4e65198d25e8a3))
* warn about music and sound on the story's first screen, which browsers won't play before a click ([#517](https://github.com/textadventures/squiffy/issues/517)) ([d49f59a](https://github.com/textadventures/squiffy/commit/d49f59a5a9537b0e66b2fe0f2b8b65c6bd4bb2ea))


### Bug Fixes

* {{#every}} in {{#style}}, panels after a reload, {{restart}} links in --play, and [@music](https://github.com/music) files in builds ([#505](https://github.com/textadventures/squiffy/issues/505)) ([9a8ed03](https://github.com/textadventures/squiffy/commit/9a8ed03d10838ee20910895d16a6a9e63e245ed5))
* a story's stylesheet can change the side panel's border and padding ([#511](https://github.com/textadventures/squiffy/issues/511)) ([c7ec891](https://github.com/textadventures/squiffy/commit/c7ec891e1a0e814830e7ad18d3f54f14866712e7))
* keep the Fonts dialog the same size while searching ([#491](https://github.com/textadventures/squiffy/issues/491)) ([670ef26](https://github.com/textadventures/squiffy/commit/670ef2685c68ede4a036500346b58dfab9d85e46))
* links come back after {{#replace}}, even if a link inside the label has just been clicked ([#513](https://github.com/textadventures/squiffy/issues/513)) ([d75d0f4](https://github.com/textadventures/squiffy/commit/d75d0f4e6fd9def94460b6573138bb6213bbe177))
* messages call a section without a name of its own by its +++ or --- line, not _continue1 ([#503](https://github.com/textadventures/squiffy/issues/503)) ([ca023a8](https://github.com/textadventures/squiffy/commit/ca023a8235e3ca45db2694baf838e25dd3e46888))
* Quest gamebooks with odd flag names, or conditions in a link's text, convert to valid Squiffy ([#508](https://github.com/textadventures/squiffy/issues/508)) ([8e6704a](https://github.com/textadventures/squiffy/commit/8e6704aa9dcdbf85489f313aae39a52017f593b9))
* run [@ui](https://github.com/ui) start-up code from a save or a chosen section, and find the master section's passages in --check and --random ([#518](https://github.com/textadventures/squiffy/issues/518)) ([22ad57b](https://github.com/textadventures/squiffy/commit/22ad57b7dc760a3cbda67802b084b818459ddd55))
* scroll: "element" scrolls only the story's own box, not the page around it ([#515](https://github.com/textadventures/squiffy/issues/515)) ([0504a79](https://github.com/textadventures/squiffy/commit/0504a79485f3a36327d83634e0e380e17f161a8a))
* the page scrolls down to new text once an {{#every}} in it has filled in ([#512](https://github.com/textadventures/squiffy/issues/512)) ([2ffad54](https://github.com/textadventures/squiffy/commit/2ffad542fc2bc8669ac7bdb37e53e2138c97532b))
* the preview puts a story's classes on #squiffy, as a published story does ([#520](https://github.com/textadventures/squiffy/issues/520)) ([743334f](https://github.com/textadventures/squiffy/commit/743334fcd6ca9ffd2178be38a32f149146bd31a1))
* typewriter text and wave continue links only break lines between words ([#510](https://github.com/textadventures/squiffy/issues/510)) ([367b59d](https://github.com/textadventures/squiffy/commit/367b59dc7296e62605a2ab3d9f9e9c2438fac3f0))

## [7.0.0-beta.7](https://github.com/textadventures/squiffy/compare/v7.0.0-beta.6...v7.0.0-beta.7) (2026-11-20)


### Features

* --check, --play and --random in the CLI, for checking and playing stories without a browser ([#475](https://github.com/textadventures/squiffy/issues/475)) ([f9bfa37](https://github.com/textadventures/squiffy/commit/f9bfa373a5b1a824fa57d7bdf4a6b9ddcb4208ee))
* [@class](https://github.com/class) and class helpers, so a scene can change how the page looks ([#473](https://github.com/textadventures/squiffy/issues/473)) ([ae46c35](https://github.com/textadventures/squiffy/commit/ae46c35234cf4f54905624e3bc152270ccfb22c0))
* [@sound](https://github.com/sound) stop and {{stopsounds}}, to stop sounds playing once ([#471](https://github.com/textadventures/squiffy/issues/471)) ([0fb33ab](https://github.com/textadventures/squiffy/commit/0fb33abdb3ca5731d227c11980d2829fa429806f))
* a Fonts dialog that copies web fonts into the story ([#464](https://github.com/textadventures/squiffy/issues/464)) ([df143ea](https://github.com/textadventures/squiffy/commit/df143ea4eb6ebe6fbff1a6bac0303d6f8f248536))
* a Squiffy plugin for Claude Code, with a skill for writing, checking and playing stories ([#477](https://github.com/textadventures/squiffy/issues/477)) ([69fc6e3](https://github.com/textadventures/squiffy/commit/69fc6e3ba935c4b70c7b20c51230e402cbee8136))
* array helpers for joining, sorting, slicing and counting ([#470](https://github.com/textadventures/squiffy/issues/470)) ([8c8226b](https://github.com/textadventures/squiffy/commit/8c8226becc56cf6595be0564629c02e3ef1270f6))
* embed parameters and wrapped text, and the Twine importer converts widgets and macros ([#450](https://github.com/textadventures/squiffy/issues/450)) ([#474](https://github.com/textadventures/squiffy/issues/474)) ([fca5253](https://github.com/textadventures/squiffy/commit/fca5253091a81fc6a9ed071e49e91ce66f218667))
* helpers for text, numbers and conditional values ([#467](https://github.com/textadventures/squiffy/issues/467)) ([8260ee1](https://github.com/textadventures/squiffy/commit/8260ee1dc5c86f69c2315be0710e4a27bccb6479))
* music and sound, with [@music](https://github.com/music), [@sound](https://github.com/sound) and a mute button ([#468](https://github.com/textadventures/squiffy/issues/468)) ([249aa4c](https://github.com/textadventures/squiffy/commit/249aa4ce22721f60598c72c23ac467c8d9c100a5))
* New story in the desktop app asks for a name and makes its folder ([#460](https://github.com/textadventures/squiffy/issues/460)) ([e9036db](https://github.com/textadventures/squiffy/commit/e9036db2f5de9e7e73914d928235f1f85c963f77))
* objects, attributes that hold named values ([#465](https://github.com/textadventures/squiffy/issues/465)) ([2e50467](https://github.com/textadventures/squiffy/commit/2e504670e516fd8e7c9ca7b15c9729845f80ddd2))
* Open file converts a Quest gamebook or Twine story in a zip ([#463](https://github.com/textadventures/squiffy/issues/463)) ([4d740ae](https://github.com/textadventures/squiffy/commit/4d740aee4e032139c4e32dcbe16628e15f9038ee))
* passage links in a loop work on their own, and the Twine importer converts them ([#472](https://github.com/textadventures/squiffy/issues/472)) ([d013d27](https://github.com/textadventures/squiffy/commit/d013d27f6906b71601f0435b018879c00d24f845))
* the Twine and Quest importers convert sound to [@music](https://github.com/music) and [@sound](https://github.com/sound) ([#469](https://github.com/textadventures/squiffy/issues/469)) ([ed926f0](https://github.com/textadventures/squiffy/commit/ed926f010f15c72b384f2c9b640f96d83b9f8c16))


### Bug Fixes

* Undo and Redo in the desktop app's Edit menu work in the editor ([#462](https://github.com/textadventures/squiffy/issues/462)) ([299a5f9](https://github.com/textadventures/squiffy/commit/299a5f9c9cfaa4baff87a55b4c98f8bc594a6d0f))

## [7.0.0-beta.6](https://github.com/textadventures/squiffy/compare/v7.0.0-beta.5...v7.0.0-beta.6) (2026-11-19)


### Features

* a light/dark button in the editor's preview ([#433](https://github.com/textadventures/squiffy/issues/433)) ([5510653](https://github.com/textadventures/squiffy/commit/5510653e3e3e681195c1c781048c8b8c9bc05f2f))
* a squiffy.json includes the folder's stylesheets and scripts ([#435](https://github.com/textadventures/squiffy/issues/435)) ([df56e37](https://github.com/textadventures/squiffy/commit/df56e3780cb89f06df9eeadbbbfd87b6cef55d27))
* convert Quest gamebooks to Squiffy ([#457](https://github.com/textadventures/squiffy/issues/457)) ([5ce53c3](https://github.com/textadventures/squiffy/commit/5ce53c30173afc25a037424e70fceb6fd6b56bec))
* easier story styles: a Stylesheet option, a starter file, and font variables ([#198](https://github.com/textadventures/squiffy/issues/198)) ([#432](https://github.com/textadventures/squiffy/issues/432)) ([d602b98](https://github.com/textadventures/squiffy/commit/d602b989f9589fcba56c6ccd3583392e5a9b13cd))
* icon header buttons, with translatable tooltips in squiffy.json ([#423](https://github.com/textadventures/squiffy/issues/423)) ([8ab46ac](https://github.com/textadventures/squiffy/commit/8ab46ac8382b136cb826d7371739fb1298924ba8))
* loops with links and attributes inside {{#each}} ([#437](https://github.com/textadventures/squiffy/issues/437)) ([327fb5b](https://github.com/textadventures/squiffy/commit/327fb5bba2e1e0ff4ae4e838b6ca86ad1bdac0d0))
* panels, passages always to hand beside the story or in a dialog ([#459](https://github.com/textadventures/squiffy/issues/459)) ([d5c1383](https://github.com/textadventures/squiffy/commit/d5c1383c1f7e4cfd24d6d5207e2398e747d21f58))
* passages you can click again, with [@repeat](https://github.com/repeat) ([#104](https://github.com/textadventures/squiffy/issues/104)) ([#428](https://github.com/textadventures/squiffy/issues/428)) ([8768337](https://github.com/textadventures/squiffy/commit/87683378f7a4052b72170331492a481ee3b571e3))
* previous and previous_section attributes ([#421](https://github.com/textadventures/squiffy/issues/421)) ([29e7d1b](https://github.com/textadventures/squiffy/commit/29e7d1b64a04a6eb015e1feda37551dc49eab070))
* run JavaScript after the text with squiffy.ui.afterWrite ([#106](https://github.com/textadventures/squiffy/issues/106)) ([#430](https://github.com/textadventures/squiffy/issues/430)) ([adf7059](https://github.com/textadventures/squiffy/commit/adf7059200913de484c90c69f98470573f3e8b73))
* saved games, with a Saved games dialog and save files ([#427](https://github.com/textadventures/squiffy/issues/427)) ([40738ab](https://github.com/textadventures/squiffy/commit/40738ab09f006ce0caedfe69ac2f8df70eedf308))
* the editor's preview shows CSS changes as you type ([#434](https://github.com/textadventures/squiffy/issues/434)) ([63800ca](https://github.com/textadventures/squiffy/commit/63800caeefe46ff6bf748201897fa6116503b3be))
* the Quest gamebook importer converts page scripts ([#458](https://github.com/textadventures/squiffy/issues/458)) ([b01c6ed](https://github.com/textadventures/squiffy/commit/b01c6edb7111655c7e4a6ac60c1e1a0086b163fe))
* the Twine importer converts for loops to {{#each}} ([#441](https://github.com/textadventures/squiffy/issues/441)) ([5344ee5](https://github.com/textadventures/squiffy/commit/5344ee55b2ef338e4918bffaa7dbd91a26952ef4))
* turn off passage links with {{deactivate}} ([#13](https://github.com/textadventures/squiffy/issues/13)) ([#429](https://github.com/textadventures/squiffy/issues/429)) ([0b1d85e](https://github.com/textadventures/squiffy/commit/0b1d85efb01298ca735dc79d3dd9d7c94a6ad2ae))


### Bug Fixes

* New story works in the Windows desktop app ([#439](https://github.com/textadventures/squiffy/issues/439)) ([7c2da5e](https://github.com/textadventures/squiffy/commit/7c2da5e9eb75be7e9e2327cb833828f5a3be144a))
* no separator line for a passage that outputs no text ([#424](https://github.com/textadventures/squiffy/issues/424)) ([3cfeb88](https://github.com/textadventures/squiffy/commit/3cfeb8854f6639cab97de1f3319c19de2c8e1270))
* the desktop app's window appears on Linux with Wayland ([#440](https://github.com/textadventures/squiffy/issues/440)) ([ed965c1](https://github.com/textadventures/squiffy/commit/ed965c1a29852d942bebee4384ac7d1bb82d2e2c))
* the story map stays responsive on big stories ([#436](https://github.com/textadventures/squiffy/issues/436)) ([123ad47](https://github.com/textadventures/squiffy/commit/123ad470115ee397be4bf941002d5c1418ed7f33))

## [7.0.0-beta.5](https://github.com/textadventures/squiffy/compare/v7.0.0-beta.4...v7.0.0-beta.5) (2026-11-18)


### Features

* {{goto}} helper to go to another section from story text ([#402](https://github.com/textadventures/squiffy/issues/402)) ([b62fffd](https://github.com/textadventures/squiffy/commit/b62fffd25bf60a693364d3671546a1cb44a987ea))
* a Back button for players in published stories ([#417](https://github.com/textadventures/squiffy/issues/417)) ([029bacf](https://github.com/textadventures/squiffy/commit/029bacf5c3109076d8d071e2c67721a6ddfeffb3))
* a Problems panel listing every problem in the story ([#410](https://github.com/textadventures/squiffy/issues/410)) ([cfc2ebf](https://github.com/textadventures/squiffy/commit/cfc2ebf822797958458b169ff66c3162eda7692a))
* call stories kept in the browser that, not drafts, and remind authors to download a copy ([#412](https://github.com/textadventures/squiffy/issues/412)) ([ca8a3f1](https://github.com/textadventures/squiffy/commit/ca8a3f114444b2b9e2cc8f8a293a061c96247e2c))
* fewer crossing links on the story map ([#408](https://github.com/textadventures/squiffy/issues/408)) ([76ec854](https://github.com/textadventures/squiffy/commit/76ec8546544ec03c3f41b1ddbffddb9c016908fb))
* fold a long story's map into columns, and fade long links ([#405](https://github.com/textadventures/squiffy/issues/405)) ([e5f708c](https://github.com/textadventures/squiffy/commit/e5f708c9b1701c9e4a42315a4f3c54ce802530ee))
* import Twine stories (Twee and Twine HTML; Harlowe and SugarCube) ([#404](https://github.com/textadventures/squiffy/issues/404)) ([85079c9](https://github.com/textadventures/squiffy/commit/85079c9077762054338b2a9187307d047c3ccd8e))
* keep a Twine story's map layout when importing it ([#407](https://github.com/textadventures/squiffy/issues/407)) ([6f6c0ff](https://github.com/textadventures/squiffy/commit/6f6c0ff9e81f32c9d52d2c3e80033377d2ad6ded))
* resize the Problems panel, and name the section in its section warnings ([#411](https://github.com/textadventures/squiffy/issues/411)) ([0ee8989](https://github.com/textadventures/squiffy/commit/0ee8989a1094d73389172ea25128f2fb964ce5da))
* visit counts and a story-wide turn count ([#403](https://github.com/textadventures/squiffy/issues/403)) ([b00578f](https://github.com/textadventures/squiffy/commit/b00578fb08c16cbb3815cae780183871b0335bb6))


### Bug Fixes

* include a story's own CSS and JS in single-file exports ([#414](https://github.com/textadventures/squiffy/issues/414)) ([249ddde](https://github.com/textadventures/squiffy/commit/249ddde7ddb7e163ae3be9eac8ff7b51f9a61809))
* let the desktop app's Open file dialog pick Twine and zip files ([#406](https://github.com/textadventures/squiffy/issues/406)) ([b4b4f2d](https://github.com/textadventures/squiffy/commit/b4b4f2d365fd214913429f7ae3e3490b6a4f737f))
* line up the editor's fold chevrons, and make its warning icons easier to see ([#409](https://github.com/textadventures/squiffy/issues/409)) ([b2838ec](https://github.com/textadventures/squiffy/commit/b2838ecea83c72fdc8c56ff3d9da8cc2a1c6af38))
* link the desktop app's update banner to the download page in the docs ([#400](https://github.com/textadventures/squiffy/issues/400)) ([6eab6b4](https://github.com/textadventures/squiffy/commit/6eab6b466e9026dc645bb12dbd4731ea6ec96d9f))

## [7.0.0-beta.4](https://github.com/textadventures/squiffy/compare/v7.0.0-beta.3...v7.0.0-beta.4) (2026-11-17)


### Features

* arithmetic in infix expressions, and expressions in {{set}}, {{inc}}, {{dec}} and {{= }} ([#391](https://github.com/textadventures/squiffy/issues/391)) ([656dd08](https://github.com/textadventures/squiffy/commit/656dd08c9b9a480282dd8813f9743bc774e0079b))
* convert Squiffy 6 setters when a story gets a squiffy.json ([#396](https://github.com/textadventures/squiffy/issues/396)) ([e25bcd4](https://github.com/textadventures/squiffy/commit/e25bcd4bc0f7e39be3c1b689110c13bebd6cf776))
* expressions in [@set](https://github.com/set) and link setters, for stories with a squiffy.json ([#395](https://github.com/textadventures/squiffy/issues/395)) ([cdbc641](https://github.com/textadventures/squiffy/commit/cdbc6417f1f530ce6457ca10a8b12b9b6c92da18))
* warn about text without quotes in setters in a story with a squiffy.json ([#399](https://github.com/textadventures/squiffy/issues/399)) ([56a3667](https://github.com/textadventures/squiffy/commit/56a36675d228f0b18f992cfb7abad29a8ad5fcfb))


### Bug Fixes

* allow brackets in link setters ([#398](https://github.com/textadventures/squiffy/issues/398)) ([e1a0084](https://github.com/textadventures/squiffy/commit/e1a00846344769e56093402bf98ea3740df381c0))
* desktop app icon frame, About window, beta banner and folder wording ([#393](https://github.com/textadventures/squiffy/issues/393)) ([647f5e6](https://github.com/textadventures/squiffy/commit/647f5e60c7b7b4471731b2f931f91e83a5813615))
* use numbers stored as text in {{inc}}, {{dec}}, [@inc](https://github.com/inc), [@dec](https://github.com/dec) and += ([#394](https://github.com/textadventures/squiffy/issues/394)) ([8298276](https://github.com/textadventures/squiffy/commit/829827603e9408b79fb52b096ccb07baf99932d8))

## [7.0.0-beta.3](https://github.com/textadventures/squiffy/compare/v7.0.0-beta.2...v7.0.0-beta.3) (2026-11-17)


### Features

* package the desktop app for macOS, Windows and Linux, and attach it to each release ([#387](https://github.com/textadventures/squiffy/issues/387)) ([3da6c9e](https://github.com/textadventures/squiffy/commit/3da6c9e028bc9d674463dd4604d2af907089d6d4))
* run the editor as an Electron desktop app, with stories in folders on disk ([#383](https://github.com/textadventures/squiffy/issues/383)) ([2b44384](https://github.com/textadventures/squiffy/commit/2b44384c14099b48df735b607d85017a23074a41))
* tell desktop app users when a new version is out, and add a downloads page ([#388](https://github.com/textadventures/squiffy/issues/388)) ([eea532a](https://github.com/textadventures/squiffy/commit/eea532a21424236ab50505af08d50444b52e0b6b))


### Bug Fixes

* scroll up to the start of the new screen after [@clear](https://github.com/clear) ([#390](https://github.com/textadventures/squiffy/issues/390)) ([b03fe38](https://github.com/textadventures/squiffy/commit/b03fe380450af7182fbd5ba23e1720291d837e92))

## [7.0.0-beta.2](https://github.com/textadventures/squiffy/compare/v7.0.0-beta.1...v7.0.0-beta.2) (2026-11-17)


### Features

* add a TextMate grammar for .squiffy files, and highlight the docs' Squiffy samples ([#356](https://github.com/textadventures/squiffy/issues/356)) ([60a60d1](https://github.com/textadventures/squiffy/commit/60a60d1428fbc22941b52beba5825b03457a976e))
* dark mode and a refreshed default style for published stories ([#370](https://github.com/textadventures/squiffy/issues/370)) ([58c5524](https://github.com/textadventures/squiffy/commit/58c55247fedcafec0729638fb70694e4c1324367))
* highlight CSS and JavaScript files in the editor ([#363](https://github.com/textadventures/squiffy/issues/363)) ([690421c](https://github.com/textadventures/squiffy/commit/690421cc74cea683f008cf17e084a386b1c8ddb4))
* squiffy.json project files in the editor ([#367](https://github.com/textadventures/squiffy/issues/367)) ([5f9bcf7](https://github.com/textadventures/squiffy/commit/5f9bcf778434e1ca0251c61787dea3ca277cebd8))
* story graph in the language service, with unreachable section and dead end checks ([#381](https://github.com/textadventures/squiffy/issues/381)) ([67b75ec](https://github.com/textadventures/squiffy/commit/67b75ec816f24e8ba322cb4f728404ba15b6e1c0))
* story map in the editor ([#382](https://github.com/textadventures/squiffy/issues/382)) ([5562e28](https://github.com/textadventures/squiffy/commit/5562e2898ce133e2f8fc02ff6bf5eeab2bb5d5b9))
* treat a folder with a squiffy.json as one story ([#366](https://github.com/textadventures/squiffy/issues/366)) ([a8e3c8d](https://github.com/textadventures/squiffy/commit/a8e3c8d8ac3974a083140cef58a370e813fe9c8d))
* warn when a section name is used more than once ([#365](https://github.com/textadventures/squiffy/issues/365)) ([e94bc82](https://github.com/textadventures/squiffy/commit/e94bc8206319c133e7e7060c591a162299bf7798))


### Bug Fixes

* explain when the browser blocks the editor's storage ([#362](https://github.com/textadventures/squiffy/issues/362)) ([09b95f1](https://github.com/textadventures/squiffy/commit/09b95f1949b997d01f43dfe2bb5b69781c04b167))
* import wildcard matches in a predictable order in the CLI and Vite plugin ([#364](https://github.com/textadventures/squiffy/issues/364)) ([c442a74](https://github.com/textadventures/squiffy/commit/c442a74e819bd3b156d7ef3d0de711e89b190dd5))
* show "(Start)" and +++/--- lines in the outline instead of internal section names ([#369](https://github.com/textadventures/squiffy/issues/369)) ([55c9dd1](https://github.com/textadventures/squiffy/commit/55c9dd1f03cfb5882b04647b8eaf20a48b718c2f))
* smooth resizing of the editor's preview and sidebar panes ([#368](https://github.com/textadventures/squiffy/issues/368)) ([ef44760](https://github.com/textadventures/squiffy/commit/ef4476066a2f1b5e04125ae17fde33afbe24858d))
* start the story at the main file's first section, even after an [@import](https://github.com/import) ([#360](https://github.com/textadventures/squiffy/issues/360)) ([910f0c8](https://github.com/textadventures/squiffy/commit/910f0c8d845a375b614328346452a852b58069ac))

## [7.0.0-beta.1](https://github.com/textadventures/squiffy/compare/v6.0.1...v7.0.0-beta.1) (2026-11-16)


### Features

* add a language service, exported as squiffy-compiler/language-service ([#344](https://github.com/textadventures/squiffy/issues/344)) ([2a69c56](https://github.com/textadventures/squiffy/commit/2a69c5695340b04d6f664acf679bbd66d370e67c))
* add a sandboxed preview page and host helper to squiffy-runtime ([#345](https://github.com/textadventures/squiffy/issues/345)) ([e21d4f9](https://github.com/textadventures/squiffy/commit/e21d4f9ed8e7f90798260745f66862f25e082ed7))
* add project file system layer for the editor ([#339](https://github.com/textadventures/squiffy/issues/339)) ([f07606f](https://github.com/textadventures/squiffy/commit/f07606f7e88789d8721742f31f1ea4e4becfa93f))
* asset URL resolution hook and asset bundling ([#277](https://github.com/textadventures/squiffy/issues/277)) ([#337](https://github.com/textadventures/squiffy/issues/337)) ([180da33](https://github.com/textadventures/squiffy/commit/180da33b3cc879ec02b777e18f4cc37505f1aa70))
* completion, hover, rename, references and quick fixes in the new editor ([#347](https://github.com/textadventures/squiffy/issues/347)) ([4a11d55](https://github.com/textadventures/squiffy/commit/4a11d55015b1c11b73a7375321a20e6fecc36ecc))
* multi-file projects and images in the new editor ([#349](https://github.com/textadventures/squiffy/issues/349)) ([163b874](https://github.com/textadventures/squiffy/commit/163b874acc7541f8cd70e4ea05dff4cc188d6b3d))
* publish the story and download the project from the new editor ([#350](https://github.com/textadventures/squiffy/issues/350)) ([ec5d77b](https://github.com/textadventures/squiffy/commit/ec5d77b0817a519061efe536294738c3dcd6c51f))
* replace the 6.x editor with the new one on app.squiffystory.com ([#353](https://github.com/textadventures/squiffy/issues/353)) ([0b377f1](https://github.com/textadventures/squiffy/commit/0b377f10c0da99c91e77e8fe7d6be03da98b640a))
* run the story in a preview beside the new editor ([#348](https://github.com/textadventures/squiffy/issues/348)) ([d7798d4](https://github.com/textadventures/squiffy/commit/d7798d4a7c142a8c8f259b554d38ac286f237b6c))
* split compiler into parse, analyse and emit, with structured diagnostics ([#338](https://github.com/textadventures/squiffy/issues/338)) ([305949d](https://github.com/textadventures/squiffy/commit/305949d356464bd2a12d5cf4620364f384a135f0))
* start the Squiffy 7 editor rebuild (milestone 1: shell, open/save, diagnostics, outline) ([#346](https://github.com/textadventures/squiffy/issues/346)) ([d7af2ba](https://github.com/textadventures/squiffy/commit/d7af2ba639f450d23a4e1559ee22c604facd9dfe))
* the 6.x editor's remaining features in the new editor ([#352](https://github.com/textadventures/squiffy/issues/352)) ([f237b17](https://github.com/textadventures/squiffy/commit/f237b1720b30a88bb2fed61417c47d76483f12bc))
* work offline, update banner and recent folders in the new editor ([#351](https://github.com/textadventures/squiffy/issues/351)) ([77e6568](https://github.com/textadventures/squiffy/commit/77e6568fb2815b0784dfb386ea5706aa4bdbc520))


### Bug Fixes

* don't report project-fs's own writes as external changes when the watcher flushes mid-write ([#354](https://github.com/textadventures/squiffy/issues/354)) ([b16d7b3](https://github.com/textadventures/squiffy/commit/b16d7b35c7ab5dcd850d12f96795b1977b1ba862))
* link the beta docs to the beta editor, and tidy the Run split button ([#355](https://github.com/textadventures/squiffy/issues/355)) ([15cd583](https://github.com/textadventures/squiffy/commit/15cd583834e8513fbb49d98394e53e856322ff22))
* resolve asset URLs inside animate blocks ([#343](https://github.com/textadventures/squiffy/issues/343)) ([b034dc5](https://github.com/textadventures/squiffy/commit/b034dc5172be50d90a711912a0a7ab0ed9ec748b))

## [6.0.1](https://github.com/textadventures/squiffy/compare/v6.0.0...v6.0.1) (2026-10-18)


### Bug Fixes

* keep the editor usable when a story fails to start or uses [@import](https://github.com/import) ([#316](https://github.com/textadventures/squiffy/issues/316)) ([350dca0](https://github.com/textadventures/squiffy/commit/350dca0226e8da2422b1538b1980b83f5d2ffd68))

## [6.0.0](https://github.com/textadventures/squiffy/compare/v6.0.0-beta.5...v6.0.0) (2026-10-13)


### Bug Fixes

* load the editor's icon fonts when offline ([#311](https://github.com/textadventures/squiffy/issues/311)) ([afc62c0](https://github.com/textadventures/squiffy/commit/afc62c0a037b6865c159fb2cd047e79901747f84))


### Miscellaneous Chores

* prepare release-please and the release workflows for 6.0.0 ([#314](https://github.com/textadventures/squiffy/issues/314)) ([c6ea48b](https://github.com/textadventures/squiffy/commit/c6ea48b5b05ddc5221de6f844330d11c10a82a8d))

## [6.0.0-beta.5](https://github.com/textadventures/squiffy/compare/v6.0.0-beta.4...v6.0.0-beta.5) (2026-10-11)


### Features

* point the editor's Help menu at Getting Started and the Squiffy games catalogue ([#300](https://github.com/textadventures/squiffy/issues/300)) ([b3d5140](https://github.com/textadventures/squiffy/commit/b3d5140042d3edde61aaba8d301d255fa34c799a))
* warn about Squiffy 5 text processor syntax and offer conversion ([#296](https://github.com/textadventures/squiffy/issues/296)) ([d3f6ac6](https://github.com/textadventures/squiffy/commit/d3f6ac6d05907d4f5f060c722c171e33f09dd2f8))


### Bug Fixes

* add squiffy.story.seen() to the JavaScript API ([#298](https://github.com/textadventures/squiffy/issues/298)) ([8b9ffa5](https://github.com/textadventures/squiffy/commit/8b9ffa5dd0831f6f8a7785b01a995d2f0b8f14cf))
* don't convert square brackets inside Handlebars expressions to links ([#294](https://github.com/textadventures/squiffy/issues/294)) ([35ffc38](https://github.com/textadventures/squiffy/commit/35ffc38cefb55f6c618828d5aa3b08e75176993c))

## [6.0.0-beta.4](https://github.com/textadventures/squiffy/compare/v6.0.0-beta.3...v6.0.0-beta.4) (2026-10-10)


### Features

* add a Vite plugin for importing .squiffy files into a web app ([#126](https://github.com/textadventures/squiffy/issues/126)) ([5902597](https://github.com/textadventures/squiffy/commit/59025973db4e0dc0613e919a1f0e16f4b645dca6))
* allow registering custom helpers from [@ui](https://github.com/ui) JavaScript ([#289](https://github.com/textadventures/squiffy/issues/289)) ([f5b1401](https://github.com/textadventures/squiffy/commit/f5b1401a0d0514816f9f9b483a8af800db6c7b2e))
* support infix expressions in {{#if}} conditions ([#287](https://github.com/textadventures/squiffy/issues/287)) ([d24fc40](https://github.com/textadventures/squiffy/commit/d24fc40e9752fea02b7ae55f9be20e5f2460d835))


### Bug Fixes

* allow section and passage helpers to take a SafeString, e.g. from random ([#290](https://github.com/textadventures/squiffy/issues/290)) ([111af08](https://github.com/textadventures/squiffy/commit/111af0801dd24fc796e537663f00103e296b0c22))
* embed sections and passages added during a live update ([#291](https://github.com/textadventures/squiffy/issues/291)) ([68acf37](https://github.com/textadventures/squiffy/commit/68acf378b05fd4de07eca0110d72d2e5d39104f2))
* keep link-triggered animation links disabled after the animation finishes ([#293](https://github.com/textadventures/squiffy/issues/293)) ([308866e](https://github.com/textadventures/squiffy/commit/308866eb2f85cc9e200453d953e584ed35d0effe))
* make the Back button restore inputs and ignore presses during transitions ([#292](https://github.com/textadventures/squiffy/issues/292)) ([37ea8e4](https://github.com/textadventures/squiffy/commit/37ea8e4db51eeb9d8ec1c84b13543e94b2afc6c8))

## [6.0.0-beta.3](https://github.com/textadventures/squiffy/compare/v6.0.0-beta.2...v6.0.0-beta.3) (2026-10-10)


### Bug Fixes

* don't mistake image links for passage links ([#185](https://github.com/textadventures/squiffy/issues/185)) ([d796a1c](https://github.com/textadventures/squiffy/commit/d796a1cd6245116c321b98d3afcf390c6e0ee338))
* warn when {{embed}} names a section or passage that doesn't exist ([#282](https://github.com/textadventures/squiffy/issues/282)) ([dbb9070](https://github.com/textadventures/squiffy/commit/dbb90707685d5e36410bbd9dae22a66a72bd2eb6))
