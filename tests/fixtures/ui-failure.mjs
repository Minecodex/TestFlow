// Deliberate render failure, only imported into disposable browser acceptance workspaces.
export const sdk = 'testflow.ui.v1';
export default function TestConfigurationFailure() {
  throw new Error('TEST ONLY: configuration component render failure');
}
