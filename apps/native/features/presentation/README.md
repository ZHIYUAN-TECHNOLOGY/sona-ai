# Clinical response composition

`ClinicalResponseRenderer` turns fixture JSON specifications into the existing React Native feature cards using `@json-render/core` and `@json-render/react-native`. This is real JSON rendering with authored composition fixtures, not live model inference.

The catalogue contains a response column, seven clinical feature leaves, a context notice and a source action. Progressive snapshots retain stable node IDs. Incomplete encounters lead with missing context; fuller encounters lead with their result. Later snapshots add context and a validated source link.

Only result, source and notice identifiers appear in component props. Authoritative patient snapshots, result data and callbacks arrive through React context. Catalogue validation is followed by encounter identity, component, source and small-tree checks. Standard components and arbitrary event bindings are disabled for this fixture adapter. Clinical checks, actions and prescription status remain in their existing implementations. Visible fallbacks wrap registered clinical leaves because the upstream renderer's own element boundary otherwise hides component exceptions.

JEV remains optional and deferred. Its official documentation currently describes `experimental_composeSpec` and `experimental_createEvaluator` as unreleased source-build APIs. This milestone does not require a gateway, credentials or external inference. A future backend adapter can supply validated specifications or compiled SpecStream patches using the same catalogue; it must preserve request cancellation, encounter revisions and source checks.

References, checked 23 September 2026:

- [React Native renderer](https://json-render.dev/docs/api/react-native)
- [Catalogue and validation](https://json-render.dev/docs/api/core)
- [SpecStream](https://json-render.dev/docs/streaming)
- [JEV availability and limits](https://json-render.dev/docs/jev)

The main agent owns package installation, workspace wiring and runtime verification.
