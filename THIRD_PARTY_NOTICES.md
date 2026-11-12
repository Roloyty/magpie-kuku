# Third-party notices

## Kuku protocol implementation

Endpoint sequences, request fields and response handling in `lib/api.mjs`,
`lib/checkin.mjs` and `lib/chat.mjs` are adapted into JavaScript from the Kuku
provider in [ProvidersPlugin/Agent2Providers](https://github.com/ProvidersPlugin/Agent2Providers/tree/main/crates/providers/src/providers/kuku).
Upstream copyright belongs to the Agent2Providers contributors. Upstream is
licensed under GNU Affero General Public License v3.0. This project is distributed
under AGPL-3.0-only; see LICENSE. Modifications: Magpie hooks, browser sign-in,
account isolation, strict check-in confirmation, credential redaction, and
OpenAI-compatible response streams.

## OpenCode 2.x adapter

`opencode2.mjs` is copied unchanged from
[magpie-community/plugins/scripts/opencode2.mjs](https://github.com/magpie-community/plugins/blob/main/scripts/opencode2.mjs).
Copyright (c) Magpie community contributors. The upstream MIT permission notice
follows; this file remains available under MIT:

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Compatibility references

Magpie's provider plugin contracts and existing Raccoon, Loomy and CatPaw plugins
were consulted for hook shapes. The third-party host script used for local
compatibility testing is not included in this package.
