# infra/akash — Future Akash SDL Renderer

This directory will contain the Akash SDL renderer when Akash deployments are ready.

The renderer reads `infra/catalog/*.yaml` and emits Akash SDL manifests, the same way
`infra/k8s/` reads catalog files and renders Kustomize overlays.

See `infra/provision/akash/FUTURE_AKASH_INTEGRATION.md` for the integration plan.
