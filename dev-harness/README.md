# Laptop development harness

Install dependencies with `npm install`, then run `npm run dev`. The command
starts Vite and opens praise and roast URLs in one Chromium window. Both URLs
select mock camera and generation modes; change the generated case with
`MOCK_GENERATION_CASE=skip|malformed|slow`.

## Mock camera integration

Lane A should import `kiosk/src/dev/mock-camera.ts`, branch before
`getUserMedia` when `mockCameraEnabled()` is true, then call
`createMockCameraStream(video)`. Select a clip using
`?mock_scene=empty-room|one-person|three-people`. The adapter uses the same
`HTMLVideoElement` and returns a `MediaStream` from `captureStream()`.

Run `npm run fixtures:video` to deterministically regenerate the short WebM
clips using Chromium's own VP8 encoder. The clips contain synthetic silhouettes,
not visitor imagery.

## Mock generation integration

When `MOCK_GENERATION=1`, the server can route `POST /generate` to
`handleMockGeneration(request, response)`. Cases can be selected using
`MOCK_GENERATION_CASE`, `x-mock-generation`, or `?mock_generation=`.

The skip fixture is deliberately model-shaped and contains sentinel text. For a
server safety-path test, inject it where the model response would enter parsing;
the final response must be an offline envelope and must not contain `SENTINEL`.

## Conformance tests

`npm test` checks fixture correctness. The reusable suites under
`test/conformance/` encode the required parser and state transitions without
claiming ownership of lane B/C APIs. Those lanes bind their implementations to
the documented adapters in a tiny local test file.
