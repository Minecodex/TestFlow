from pathlib import Path


class DataDirectories:
    """Platform-owned data lives outside the application's source directories."""

    names = ("assets", "module-packages", "repositories", "runs")

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def prepare(self) -> None:
        for name in self.names:
            (self.root / name).mkdir(parents=True, exist_ok=True)

    def check_writable(self) -> None:
        from tempfile import TemporaryFile

        with TemporaryFile(dir=self.root) as probe:
            probe.write(b"ready")
            probe.flush()
