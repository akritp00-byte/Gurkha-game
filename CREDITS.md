# Credits

Every third-party asset (models, textures, sounds, music, fonts) is listed here with its source and licence **before** it is committed. Only CC0 or properly licensed assets are allowed, and nothing is bought without asking first (BUILD_PROMPT.md §7).

## Art and audio

| Asset   | Used for                                                                                                                                            | Author / source | Licence |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------- |
| _None._ | Every model, plant, particle and sound is generated in code: the models at load time, the sounds synthesised in the browser with the Web Audio API. |                 |         |

## Open-source libraries

The main runtime libraries. The full dependency tree is in `pnpm-lock.yaml`.

| Library                                                                  | Used for                                            | Licence |
| ------------------------------------------------------------------------ | --------------------------------------------------- | ------- |
| [Three.js](https://threejs.org)                                          | 3D rendering                                        | MIT     |
| [Colyseus](https://colyseus.io) (core, schema, WebSocket transport, SDK) | Multiplayer rooms and state sync, client prediction | MIT     |
| [Express](https://expressjs.com) (required by the Colyseus transport)    | HTTP layer under Colyseus                           | MIT     |
| [Vite](https://vite.dev)                                                 | Client dev server and bundler                       | MIT     |
