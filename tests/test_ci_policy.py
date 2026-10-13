import json
from pathlib import Path
import sys
from types import SimpleNamespace
from http.server import HTTPServer
from threading import Thread
from urllib.request import Request, urlopen

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from ci_changes import classify
from ci_release import export_evidence
from kubernetes_support import desktop_kind_nodes

sys.path.insert(0, str(Path(__file__).resolve().parent / 'kubernetes'))
from evaluation_fixture import Handler


def test_docs_do_not_install_application_dependencies():
    assert not any(classify(['README.md', 'docs/images/example.png', 'docs/design.md',
                             'server/README.md', 'examples/module/README.md']).values())
    assert classify(['docs/demo.html'])['demo']


def test_shared_contracts_and_ci_changes_select_their_dependents():
    assert classify(['web/src/features/assets/page.tsx']) == {
        'backend': False, 'web': True, 'demo': False, 'tooling': False}
    assert classify(['server/src/testflow/features/assets/router.py']) == {
        'backend': True, 'web': False, 'demo': False, 'tooling': True}
    assert classify(['contracts/openapi.json'])['web']
    assert all(classify(['.github/workflows/release-tests.yml']).values())
    assert all(classify(['new-source-directory/main.py']).values())


@pytest.mark.parametrize(('actual', 'evidence', 'score'), [
    ('HELLO TESTFLOW', [], 1),
    ({'answer': 'wrong'}, ['supporting input'], 0),
    ({'answer': 'expected'}, [], 1),
])
def test_scoring_fixture_accepts_scalar_and_object_material(actual, evidence, score):
    server = HTTPServer(('127.0.0.1', 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        material = {'actual': actual, 'evidence': evidence, 'reference': None}
        body = {'model': 'contract-fixture', 'response_format': {'type': 'json_schema'},
                'messages': [{'role': 'system', 'content': 'protocol test'},
                             {'role': 'user', 'content': [{'type': 'text', 'text': json.dumps({'material': material})}]}]}
        request = Request(f'http://127.0.0.1:{server.server_port}/chat/completions',
                          data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
        with urlopen(request, timeout=3) as response:
            result = json.loads(json.load(response)['choices'][0]['message']['content'])
        assert result['score'] == score
        assert result['evidence'] == ['actual'] + (['evidence:0'] if evidence else [])
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


def target(context, provider):
    node = {'metadata': {'name': 'ci-control-plane'}, 'spec': {'providerID': provider},
            'status': {'nodeInfo': {'operatingSystem': 'linux', 'architecture': 'amd64'}}}
    return SimpleNamespace(context=context, run=lambda *a, **k: SimpleNamespace(stdout=json.dumps({'items': [node]})))


def test_image_import_requires_matching_ci_node_ownership(monkeypatch):
    selected = target('kind-testflow-ci-123', 'kind://docker/testflow-ci-123/ci-control-plane')
    monkeypatch.setattr('kubernetes_support.subprocess.run', lambda *a, **k: SimpleNamespace(stdout=json.dumps([
        {'Config': {'Labels': {'io.x-k8s.kind.cluster': 'testflow-ci-123'}}}])))
    assert len(desktop_kind_nodes(selected)) == 1
    monkeypatch.setattr('kubernetes_support.subprocess.run', lambda *a, **k: SimpleNamespace(stdout=json.dumps([
        {'Config': {'Labels': {'io.x-k8s.kind.cluster': 'production'}}}])))
    with pytest.raises(SystemExit, match='ownership'):
        desktop_kind_nodes(selected)


def test_foreign_clusters_and_provider_ids_reject_import():
    with pytest.raises(SystemExit, match='owned'):
        desktop_kind_nodes(target('kind-production', 'kind://docker/production/node'))
    with pytest.raises(SystemExit, match='unrecognized'):
        desktop_kind_nodes(target('kind-testflow-ci-123', 'kind://docker/other/node'))
    assert len(desktop_kind_nodes(target('docker-desktop', 'kind://docker/desktop/node'))) == 1


def test_public_evidence_excludes_private_access_traces_and_unrelated_runs(tmp_path, monkeypatch):
    monkeypatch.setattr('ci_release.ROOT', tmp_path)
    folder = tmp_path / '.data/acceptance/testflow-e2e-ci'
    folder.mkdir(parents=True)
    for name in ('result.json', 'trace.zip', 'private-trace.zip', 'access.json', 'installation.yaml', 'screen.png'):
        (folder / name).write_text(name)
    unrelated = folder.parent / 'testflow-e2e-other'
    unrelated.mkdir()
    (unrelated / 'result.json').write_text('unrelated')
    output = tmp_path / 'public'
    export_evidence(output, ['testflow-e2e-ci'])
    assert {str(path.relative_to(output)) for path in output.rglob('*') if path.is_file()} == {
        'testflow-e2e-ci/result.json', 'testflow-e2e-ci/trace.zip', 'testflow-e2e-ci/screen.png'}
    with pytest.raises(ValueError, match='owned'):
        export_evidence(output, ['testflow-e2e-../../private'])
