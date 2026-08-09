# Mock generation cases

Set `MOCK_GENERATION=1` on the server and select a case with
`MOCK_GENERATION_CASE`, the `x-mock-generation` request header, or the
`mock_generation` query parameter.

- `normal`: a valid kiosk-facing envelope.
- `skip`: a raw model-shaped skipped result with sentinel beat text. It is for
  verifying that the server discards beats before substituting an offline item.
- `malformed`: an invalid kiosk-facing envelope that must trigger local fallback.
- `slow`: waits seven seconds, longer than the frozen six-second client timeout.

The mock server adapter returns fixtures literally. Integrators testing the full
server safety path should feed `skip.json` at the model boundary, not expose it
as the final HTTP response.
