from typing import Any


class DomainError(Exception):
    """A business-rule failure with a stable machine-readable code.

    Rendered as ``{"error": <code>, **extra}`` with the given HTTP status.
    """

    def __init__(self, status_code: int, error: str, **extra: Any) -> None:
        super().__init__(error)
        self.status_code = status_code
        self.error = error
        self.extra = extra
