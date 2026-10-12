import { useResourceOptions } from "../../shared/api/hooks";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { operationKey, write } from "../../shared/api/client";
import { useResource, useWrite } from "../../shared/api/hooks";
import type {
  Binding,
  Execution,
  Pipeline,
  Profile,
  Resource,
} from "../../shared/api/types";
import { useMessages } from "../../i18n";
import {
  Action,
  Check,
  Choice,
  Dialog,
  Failure,
  JsonEditor,
  Notice,
} from "../../shared/ui";
import { InputBindings } from "../datasets/case-editor";
import { PinnedChoice } from "../../shared/ui/pinned-choice";
import { PlanBindings, type BindingOverrides } from "../evaluation/bindings";
import { restoreDraft } from "../../shared/ui/draft-conflict";
type QuickDraft = {
  profileId: string;
  profileVersion: number;
  bindings: BindingOverrides;
  inputs: Record<string, Binding>;
  key: string;
  live: boolean;
  reference: Record<string, unknown>;
  confirmed: boolean;
};
export function QuickRun({
  pipeline,
  onClose,
  returnTo,
}: {
  pipeline: Resource<Pipeline>;
  onClose: () => void;
  returnTo?: string;
}) {
  const t = useMessages();
  const navigate = useNavigate();
  const profiles = useResourceOptions<Profile>("evaluation-profiles");
  const draftKey = `testflow.quick-draft.${pipeline.id}.v${pipeline.selected_version}`;
  const [draft, setDraft] = useState(
    () =>
      restoreDraft<QuickDraft>(draftKey, pipeline.selected_version, {
        profileId: "",
        profileVersion: 1,
        bindings: {},
        live: false,
        reference: {},
        confirmed: false,
        key: operationKey(),
        inputs: Object.fromEntries(
          pipeline.data.input_schema.fields
            .filter((field) => ["Text", "JSON"].includes(field.type))
            .map((field) => [
              field.name,
              { value: field.type === "JSON" ? {} : "" },
            ]),
        ),
      }).data,
  );
  const {
    profileId,
    profileVersion,
    bindings,
    inputs,
    key,
    live,
    reference,
    confirmed,
  } = draft;
  const patch = (changes: Partial<QuickDraft>) =>
    setDraft({ ...draft, ...changes, key: operationKey() });
  useEffect(() => {
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          base_version: pipeline.selected_version,
          data: draft,
        }),
      );
    } catch {}
  }, [draftKey, draft, pipeline.selected_version]);
  const profile = useResource<Profile>(
    "evaluation-profiles",
    profileId,
    String(profileVersion),
  );
  const [inputsValid, setInputsValid] = useState(true);
  const [referenceValid, setReferenceValid] = useState(true);
  const run = useWrite(() => {
    return write<Execution>(
      "/executions/quick",
      {
        pipeline_id: pipeline.id,
        pipeline_version: pipeline.selected_version,
        profile_id: profileId,
        profile_version: profileVersion,
        bindings,
        inputs,
        live,
        reference,
        reference_confirmed: confirmed,
      },
      "POST",
      key,
    );
  });
  return (
    <Dialog
      title={t.pipelines.quick}
      wide
      onClose={onClose}
      footer={
        <>
          <Action isDisabled={run.isPending} onPress={onClose}>
            {t.common.cancel}
          </Action>
          <Action
            primary
            isPending={run.isPending}
            isDisabled={
              !profile.data || (!live && !inputsValid) || !referenceValid
            }
            onPress={() =>
              run.mutate(undefined, {
                onSuccess: (ex) => {
                  localStorage.removeItem(draftKey);
                  navigate("/executions/" + ex.id + "?" + new URLSearchParams({return:returnTo || "/pipelines/"+pipeline.id}));
                },
              })
            }
          >
            {t.pipelines.quick}
          </Action>
        </>
      }
    >
      <div className="testflow-stack">
        <Notice>
          {pipeline.name} · v{pipeline.selected_version}
        </Notice>
        <PinnedChoice
          kind="evaluation-profiles"
          label={t.evaluation.title}
          id={profileId}
          version={profileVersion}
          resources={profiles.data?.items || []}
          onChange={(value, version) => {
            patch({ profileId: value, profileVersion: version, bindings: {} });
          }}
        />
        {pipeline.data.input_schema.fields.every((f) => f.stream) && (
          <Check
            value={live}
            onChange={(value) => {
              patch({ live: value });
            }}
          >
            {t.executions.liveInput}
          </Check>
        )}
        {!live && (
          <InputBindings
            schema={pipeline.data.input_schema}
            value={inputs}
            onValid={setInputsValid}
            onChange={(value) => {
              patch({ inputs: value });
            }}
          />
        )}
        <JsonEditor
          label={t.common.reference}
          value={reference}
          onValid={setReferenceValid}
          onChange={(value) => {
            patch({ reference: value });
          }}
        />
        <Check
          value={confirmed}
          onChange={(value) => {
            patch({ confirmed: value });
          }}
        >
          {t.assets.confirm}
        </Check>
        {profile.data && (
          <PlanBindings
            profile={profile.data.data}
            pipeline={pipeline.data}
            value={bindings}
            onChange={(value) => {
              patch({ bindings: value });
            }}
          />
        )}
        <Failure error={run.error || profiles.error || profile.error} />
      </div>
    </Dialog>
  );
}
