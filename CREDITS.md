# Credits

Every third-party asset (models, textures, sounds, music, fonts) is listed here with its source and licence **before** it is committed. Only CC0 or properly licensed assets are allowed, and nothing is bought without asking first (BUILD_PROMPT.md §7).

## Art and audio

| Asset       | Used for                                  | Author / source | Licence |
| ----------- | ----------------------------------------- | --------------- | ------- |
| _None yet._ | All visuals so far are generated in code. |                 |         |

## Open-source libraries

The main runtime libraries. The full dependency tree is in `pnpm-lock.yaml`.

| Library                                                               | Used for                         | Licence |
| --------------------------------------------------------------------- | -------------------------------- | ------- |
| [Three.js](https://threejs.org)                                       | 3D rendering                     | MIT     |
| [Colyseus](https://colyseus.io) (core, schema, WebSocket transport)   | Multiplayer rooms and state sync | MIT     |
| [Express](https://expressjs.com) (required by the Colyseus transport) | HTTP layer under Colyseus        | MIT     |
| [Vite](https://vite.dev)                                              | Client dev server and bundler    | MIT     |
