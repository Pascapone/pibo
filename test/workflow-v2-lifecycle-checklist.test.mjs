import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
	return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

async function readWorkflowUiSourceBundle() {
	return (await Promise.all([
		"src/apps/chat-ui/src/WorkflowsArea.tsx",
		"src/apps/chat-ui/src/workflows/WorkflowBuilderNodeEditors.tsx",
		"src/apps/chat-ui/src/workflows/WorkflowGraphCanvas.tsx",
		"src/apps/chat-ui/src/workflows/WorkflowInspectorsPanel.tsx",
		"src/apps/chat-ui/src/workflows/WorkflowLibraryPanel.tsx",
		"src/apps/chat-ui/src/workflows/WorkflowRawIrEditor.tsx",
		"src/apps/chat-ui/src/workflows/WorkflowPromptAssetEditor.tsx",
		"src/apps/chat-ui/src/workflows/WorkflowVersionViewer.tsx",
	].map(readSource))).join("\n");
}

function assertAllMatch(source, checks) {
	for (const [label, pattern] of checks) {
		assert.match(source, pattern, label);
	}
}

test("Workflow V2 catalog and lifecycle checklist tests cover US-022 storage and API gates", async () => {
	const catalogEntityTests = await readSource("packages/workflows/src/testing/workflow-catalog-entities.test.ts");
	const publishedVersionTests = await readSource("packages/workflows/src/testing/workflow-published-versions.test.ts");
	const webChannelTests = await readSource("test/web-channel.test.mjs");

	assertAllMatch(catalogEntityTests, [
		["registry/store tests assert workflow source metadata", /WORKFLOW_RECORD_SOURCES[\s\S]*\["code", "ui"\][\s\S]*isWorkflowRecordSource\("deleted"\), false/],
		["registry/store tests assert workflow status metadata", /WORKFLOW_RECORD_STATUSES[\s\S]*\["draft", "published", "archived"\][\s\S]*isWorkflowRecordStatus\("deleted"\), false/],
		["registry/store tests save incomplete UI drafts without losing diagnostics", /store\.saveWorkflowDraft\(draft\)[\s\S]*assert\.deepEqual\(store\.getWorkflowDraft\(draft\.draftId\), draft\)[\s\S]*assert\.equal\(store\.getWorkflowIdentity\(definition\.id\)\?\.currentDraftId, draft\.draftId\)/],
		["registry/store tests update saved UI draft revisions", /store\.saveWorkflowDraft\(updatedDraft\)[\s\S]*assert\.deepEqual\(store\.getWorkflowDraft\(draft\.draftId\), updatedDraft\)/],
		["registry/store tests keep lifecycle entities separate", /store\.saveWorkflowIdentity\(identity\)[\s\S]*store\.saveWorkflowDraft\(draft\)[\s\S]*store\.savePublishedWorkflowVersion\(published\)[\s\S]*store\.saveWorkflowArchiveState\(archiveState\)[\s\S]*store\.saveWorkflowDeleteTombstone\(tombstone\)/],
		["registry/store tests enforce one active draft per workflow identity", /already has an active draft/],
		["registry/store tests preserve snapshots after delete tombstones", /store\.saveDefinitionSnapshot\(snapshot\)[\s\S]*store\.saveWorkflowDeleteTombstone\(tombstone\)[\s\S]*listDefinitionSnapshots\(\{ workflowId: definition\.id \}\)/],
	]);

	assertAllMatch(publishedVersionTests, [
		["published-version tests assert immutable definition hashes", /assert\.equal\(record\.definitionHash, hashWorkflowDefinition\(definition\)\)/],
		["published-version tests hydrate registry lookup from persisted records", /registerWorkflowPublishedVersion\(registry, record\)[\s\S]*resolveWorkflowDefinition\(registry, definition\.id, definition\.version\)/],
		["published-version tests reject replacement bodies", /rejects attempts to replace an existing published definition body[\s\S]*assert\.throws\(\(\) => store\.savePublishedWorkflowVersion\(changedRecord\), \/immutable\//],
	]);

	assertAllMatch(webChannelTests, [
		["catalog API tests assert source/status rows and actions", /workflow catalog list and inspect APIs expose source\/status, diagnostics, and archive filtering[\s\S]*catalogPayload\.workflows\.map\(\(workflow\) => `\$\{workflow\.id\}:\$\{workflow\.source\}:\$\{workflow\.status\}`\)[\s\S]*standard-project:code:published[\s\S]*ui-review-workflow:ui:published/],
		["catalog API tests duplicate into UI draft and surface missing refs", /const duplicateResponse = await fetch\(`\$\{baseURL\}\/api\/chat\/workflows\/standard-project\/duplicate`[\s\S]*missing-catalog-profile[\s\S]*inspectDraftPayload\.diagnostics\.some\(\(diagnostic\) => diagnostic\.registryRef === "missing-catalog-profile"\)/],
		["publish API tests create and inspect immutable version resources", /workflow catalog lifecycle APIs create, validate, publish, and expose version resources[\s\S]*assert\.match\(publishPayload\.publishedVersion\.definitionHash, \/\^sha256:\[a-f0-9\]\{64\}\$\/[\s\S]*versionInspectPayload\.version\.status, "published"/],
		["duplicate API tests handle code and UI published versions", /workflow duplicate-to-draft catalog operation handles code and UI published versions[\s\S]*sourceCodeInspectPayload\.selected\.version\.source, "code"[\s\S]*sourceUiInspectPayload\.selected\.version\.source, "ui"/],
		["archive API tests hide archived workflows by default and retain history", /workflow archive API applies at workflow identity scope and hides archived workflows from selection[\s\S]*defaultCatalogPayload\.workflows\.some\(\(workflow\) => workflow\.id === "ui-review-workflow"\), false[\s\S]*historyPayload\.options\.some/],
		["delete API tests tombstone live catalog state and preserve Project snapshots", /workflow delete API tombstones UI workflows while preserving Project snapshots[\s\S]*deletePayload\.deleted, true[\s\S]*historicalRunPayload\.snapshot\.id, sessionPayload\.snapshot\.id/],
		["next-draft API tests create then reuse the one active published edit draft", /workflow published edit creates or reuses one next-version draft[\s\S]*createPayload\.reused, false[\s\S]*reusePayload\.reused, true/],
		["picker tests cover missing workflow-version refs", /workflow version picker lists published nested workflow refs and reports missing refs[\s\S]*WorkflowCatalogError\.unknownWorkflowVersion[\s\S]*missing-workflow@9\.9\.9/],
	]);
});

test("Workflow V2 lifecycle tests cover immutable publish records and registry visibility", async () => {
	const publishedVersionTests = await readSource("packages/workflows/src/testing/workflow-published-versions.test.ts");
	const catalogEntityTests = await readSource("packages/workflows/src/testing/workflow-catalog-entities.test.ts");
	const webChannelTests = await readSource("test/web-channel.test.mjs");

	assertAllMatch(publishedVersionTests, [
		["published records store a definition hash", /assert\.equal\(record\.definitionHash, hashWorkflowDefinition\(definition\)\)/],
		["published records hydrate registry lookup by id and version", /registerWorkflowPublishedVersion\(registry, record\)[\s\S]*resolveWorkflowDefinition\(registry, definition\.id, definition\.version\)/],
		["published version bodies are immutable", /rejects attempts to replace an existing published definition body[\s\S]*assert\.throws\(\(\) => store\.savePublishedWorkflowVersion\(changedRecord\), \/immutable\//],
	]);

	assertAllMatch(catalogEntityTests, [
		["catalog entities keep identity, draft, published, archive, and tombstone records separate", /stores identity, draft, published version, archive, and tombstone records as separate entities/],
		["published catalog entities assert source and status", /assert\.equal\(published\.source, "ui"\)[\s\S]*assert\.equal\(published\.status, "published"\)/],
	]);

	assertAllMatch(webChannelTests, [
		["catalog lifecycle integration publishes UI versions", /workflow catalog lifecycle APIs create, validate, publish, and expose version resources/],
		["published API response includes a sha256 definition hash", /assert\.match\(publishPayload\.publishedVersion\.definitionHash, \/\^sha256:\[a-f0-9\]\{64\}\$\/\)/],
		["version list exposes published UI records", /versionsPayload\.versions\.map\(\(version\) => `\$\{version\.version\}:\$\{version\.source\}:\$\{version\.status\}`\)[\s\S]*\["0\.1\.1:ui:published"\]/],
		["version inspect resolves a published definition", /versionInspectPayload\.version\.status, "published"[\s\S]*versionInspectPayload\.definition\.id, "ui-lifecycle-api-draft"/],
	]);
});

test("Workflow V2 lifecycle tests cover version bumps and one-active-draft enforcement", async () => {
	const catalogEntityTests = await readSource("packages/workflows/src/testing/workflow-catalog-entities.test.ts");
	const webChannelTests = await readSource("test/web-channel.test.mjs");

	assertAllMatch(catalogEntityTests, [
		["draft store rejects a second active draft for one workflow identity", /persists partial invalid UI drafts and enforces one active draft per workflow identity[\s\S]*already has an active draft/],
	]);

	assertAllMatch(webChannelTests, [
		["patch, minor, and major version bumps are integration-tested", /workflow draft publish allocates patch, minor, and major versions/],
		["default patch publish allocates the next patch version", /patchPublish\.payload\.publishedVersion\.version, "2\.0\.1"[\s\S]*patch version bump/],
		["publishing the same draft again is idempotent", /repeatedPatchPublish\.payload\.alreadyPublished, true[\s\S]*repeatedPatchPublish\.payload\.publishedVersion\.version, "2\.0\.1"/],
		["minor intent allocates the next minor version", /minorPublish\.payload\.publishedVersion\.version, "1\.1\.0"/],
		["major intent allocates the next major version", /majorPublish\.payload\.publishedVersion\.version, "2\.0\.0"/],
		["published version rows are persisted in durable storage", /SELECT workflow_id, version FROM workflow_published_versions[\s\S]*ui-review-workflow[\s\S]*2\.0\.1/],
		["edit-published creates then reuses one next-version draft", /workflow published edit creates or reuses one next-version draft[\s\S]*createPayload\.reused, false[\s\S]*reusePayload\.reused, true/],
	]);
});

test("Workflow V2 completeness covers publish and version lifecycle UI wiring", async () => {
	const apiSource = await readSource("src/apps/chat-ui/src/api-workflows.ts");
	const workflowsAreaSource = await readWorkflowUiSourceBundle();
	const webChannelTests = await readSource("test/web-channel.test.mjs");

	assertAllMatch(apiSource, [
		["version list API uses the published-version route", /getWorkflowVersionList[\s\S]*\/api\/chat\/workflows\/\$\{encodeURIComponent\(workflowId\)\}\/versions/],
		["version inspect API uses the immutable version route", /getWorkflowVersionInspect[\s\S]*\/api\/chat\/workflows\/\$\{encodeURIComponent\(workflowId\)\}\/versions\/\$\{encodeURIComponent\(version\)\}/],
		["Project workflow version picker uses published workflow versions", /getWorkflowVersionPicker[\s\S]*\/api\/chat\/workflows\/pickers\/workflow-versions/],
		["library version history uses the version-history picker", /getWorkflowVersionHistory[\s\S]*\/api\/chat\/workflows\/pickers\/version-history/],
		["publish API submits the selected semantic version intent", /postWorkflowDraftPublish[\s\S]*versionIntent\?: "patch" \| "minor" \| "major"[\s\S]*body: JSON\.stringify\(input\)/],
		["edit-published API creates or reuses the next draft", /postWorkflowNextDraft[\s\S]*\/api\/chat\/workflows\/\$\{encodeURIComponent\(workflowId\)\}\/drafts/],
	]);

	assertAllMatch(workflowsAreaSource, [
		["library loads deterministic version history", /getWorkflowVersionHistory\(\)[\s\S]*groupWorkflowVersionHistory\(historyRows\)[\s\S]*Published versions are listed in deterministic workflow\/version order/],
		["version history rows expose next-draft editing", /hasWorkflowCatalogAction\(record, "create_next_draft"\)[\s\S]*Edit published/],
		["version history rows expose Project version selection", /hasWorkflowCatalogAction\(record, "create_project_session"\)[\s\S]*Create Project session/],
		["publish panel exposes selected version intent state", /useState<"patch" \| "minor" \| "major">\(draft\.versionIntent\)[\s\S]*Version bump intent/],
		["publish panel documents the patch default", /Default publish increments the patch version/],
		["publish panel offers patch, minor, and major choices", /Patch version bump \(default\)[\s\S]*Minor version bump[\s\S]*Major version bump/],
		["publish action sends the selected version intent", /postWorkflowDraftPublish\(currentDraft\.draftId, \{ versionIntent \}\)/],
		["publish success reports immutable definition hash", /Definition hash \$\{response\.publishedVersion\.definitionHash\}/],
	]);

	assertAllMatch(webChannelTests, [
		["publish validates before creating an immutable version", /workflow validation pipeline runs on draft load, edit, validate, and publish boundaries[\s\S]*publishPayload\.validation\.trigger, "before_publish"/],
		["publish creates immutable version resources", /workflow catalog lifecycle APIs create, validate, publish, and expose version resources[\s\S]*publishPayload\.publishedVersion\.definitionHash/],
		["version resources are inspectable", /versionInspectPayload\.version\.status, "published"[\s\S]*versionInspectPayload\.definition\.id, "ui-lifecycle-api-draft"/],
		["semantic version choices allocate patch, minor, and major versions", /workflow draft publish allocates patch, minor, and major versions[\s\S]*minorPublish\.payload\.publishedVersion\.version, "1\.1\.0"[\s\S]*majorPublish\.payload\.publishedVersion\.version, "2\.0\.0"/],
		["published edits create or reuse the next-version draft path", /workflow published edit creates or reuses one next-version draft[\s\S]*createPayload\.reused, false[\s\S]*reusePayload\.reused, true/],
		["published versions remain selectable through the workflow-version picker", /workflow version picker lists published nested workflow refs and reports missing refs[\s\S]*standard-project@1\.0\.0:published/],
	]);
});

test("Workflow V2 completeness covers archive/delete lifecycle UI and deleted-definition run links", async () => {
	const apiSource = await readSource("src/apps/chat-ui/src/api-workflows.ts");
	const workflowsAreaSource = await readWorkflowUiSourceBundle();
	const workflowViewSource = await readSource("src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx");
	const webChannelTests = await readSource("test/web-channel.test.mjs");

	assertAllMatch(apiSource, [
		["archive client posts to the workflow identity archive route", /postWorkflowArchive[\s\S]*\/api\/chat\/workflows\/\$\{encodeURIComponent\(workflowId\)\}\/archive[\s\S]*method: "POST"/],
		["delete client requires explicit workflow-id confirmation", /deleteWorkflow\(workflowId: string, input: \{ confirmWorkflowId: string \}\)[\s\S]*method: "DELETE"[\s\S]*body: JSON\.stringify\(input\)/],
		["delete response exposes tombstone metadata for historical fallbacks", /WorkflowDeleteResponse[\s\S]*lastKnownTitle: string[\s\S]*lastKnownVersion\?: string[\s\S]*lastDefinitionHash\?: string/],
	]);

	assertAllMatch(workflowsAreaSource, [
		["archive action is derived from catalog action metadata", /canArchive = published && hasWorkflowCatalogAction\(record, "archive"\)[\s\S]*Archive workflow/],
		["delete action is derived from catalog action metadata", /canDelete = published && hasWorkflowCatalogAction\(record, "delete"\)[\s\S]*Delete workflow/],
		["archive confirmation names whole-workflow scope and selection hiding", /Archiving applies to the whole workflow identity[\s\S]*hides this workflow from the default catalog and Project workflow selection lists/],
		["delete confirmation names tombstoning and authoring/start removal", /Deleting tombstones the live workflow identity[\s\S]*removes this workflow from the default catalog, workflow pickers, duplicate\/edit\/publish\/archive actions, and new Project session creation/],
		["delete confirmation names snapshot-only historical inspection", /Historical Project runs remain inspectable from immutable snapshots[\s\S]*definition-deleted state/],
	]);

	assertAllMatch(workflowViewSource, [
		["run view explains snapshot-only history when definitions are deleted", /Snapshot-only history is shown when the live definition is deleted or unavailable/],
		["run view renders definition-deleted state", /Definition deleted — snapshot-only definition-deleted state/],
		["run view omits live links for snapshot-only deleted definitions", /model\.definitionLink\.status === "live" && definitionHref[\s\S]*Open live workflow definition[\s\S]*Historical run inspection uses the immutable Project session snapshot instead of a broken live definition link/],
	]);

	assertAllMatch(webChannelTests, [
		["archive API proves identity-scope archive and selection hiding", /workflow archive API applies at workflow identity scope and hides archived workflows from selection[\s\S]*archivePayload\.archiveState\.workflowId, "ui-review-workflow"[\s\S]*defaultCatalogPayload\.workflows\.some\(\(workflow\) => workflow\.id === "ui-review-workflow"\), false/],
		["delete API proves tombstone and live-catalog removal", /workflow delete API tombstones UI workflows while preserving Project snapshots[\s\S]*deletePayload\.deleted, true[\s\S]*defaultCatalogPayload\.workflows\.some\(\(workflow\) => workflow\.id === "ui-review-workflow"\), false/],
		["delete API proves Project run snapshot fallback", /projectSession\.workflowDefinitionLink\.status, "snapshot_only_definition_deleted"[\s\S]*historicalRunPayload\.snapshot\.id, sessionPayload\.snapshot\.id[\s\S]*historicalRunPayload\.snapshot\.effectiveDefinition, sessionPayload\.snapshot\.effectiveDefinition/],
	]);
});

test("Workflow V2 lifecycle tests cover archive filters, delete tombstones, and historical snapshots", async () => {
	const catalogEntityTests = await readSource("packages/workflows/src/testing/workflow-catalog-entities.test.ts");
	const webChannelTests = await readSource("test/web-channel.test.mjs");
	const lifecycleUiTests = await readSource("test/workflow-v2-lifecycle-confirmation-ui.test.mjs");

	assertAllMatch(catalogEntityTests, [
		["delete tombstones preserve definition snapshots at the store layer", /records delete tombstones without removing historical definition snapshots[\s\S]*listDefinitionSnapshots\(\{ workflowId: definition\.id \}\)/],
	]);

	assertAllMatch(webChannelTests, [
		["archive API applies at workflow identity scope", /workflow archive API applies at workflow identity scope and hides archived workflows from selection/],
		["archived workflows are hidden from the default catalog", /defaultCatalogPayload\.workflows\.some\(\(workflow\) => workflow\.id === "ui-review-workflow"\), false/],
		["archived workflows are visible through includeArchived", /archivedCatalogPayload\.workflows\.find\(\(workflow\) => workflow\.id === "ui-review-workflow"\)[\s\S]*archivedWorkflow\.status, "archived"/],
		["archived workflows are hidden from Project workflow-version pickers", /pickerPayload\.options\.some\(\(option\) => option\.id === "ui-review-workflow"\), false/],
		["archived workflows remain in version history", /historyPayload\.options\.some\(\(option\) => `\$\{option\.id\}@\$\{option\.version\}:\$\{option\.status\}` === "ui-review-workflow@2\.0\.0:archived"\)/],
		["delete API tombstones UI workflows while preserving Project snapshots", /workflow delete API tombstones UI workflows while preserving Project snapshots/],
		["delete requires authentication and exact workflow id confirmation", /unauthenticatedDelete\.status, 401[\s\S]*badConfirmation\.status, 400[\s\S]*Type "ui-review-workflow"/],
		["delete tombstone captures last-known workflow metadata", /deletePayload\.tombstone\.lastKnownTitle, "UI Review Workflow"[\s\S]*deletePayload\.tombstone\.lastKnownVersion, "2\.0\.0"[\s\S]*lastDefinitionHash/],
		["deleted workflows are absent from catalog, picker, version history, inspect, and duplicate surfaces", /defaultCatalogPayload\.workflows\.some\(\(workflow\) => workflow\.id === "ui-review-workflow"\), false[\s\S]*archivedCatalogPayload\.workflows\.some\(\(workflow\) => workflow\.id === "ui-review-workflow"\), false[\s\S]*pickerPayload\.options\.some\(\(option\) => option\.id === "ui-review-workflow"\), false[\s\S]*historyPayload\.options\.some\(\(option\) => option\.id === "ui-review-workflow"\), false[\s\S]*inspectDeletedResponse\.status, 404[\s\S]*duplicateDeletedResponse\.status, 404/],
		["Project bootstrap renders deleted-definition snapshot-only links", /workflowDefinitionLink\.status, "snapshot_only_definition_deleted"[\s\S]*workflowDefinitionLink\.href, undefined/],
		["historical restart returns the existing run and immutable saved snapshot", /historicalRunPayload\.alreadyStarted, true[\s\S]*historicalRunPayload\.snapshot\.id, sessionPayload\.snapshot\.id[\s\S]*historicalRunPayload\.snapshot\.effectiveDefinition, sessionPayload\.snapshot\.effectiveDefinition/],
	]);

	assertAllMatch(lifecycleUiTests, [
		["UI source tests cover archive/delete confirmation safeguards", /Workflow Library renders deliberate archive and delete confirmation copy/],
		["delete confirmation requires typing the workflow id", /Workflow Library delete confirmation requires typing the workflow id/],
	]);
});
