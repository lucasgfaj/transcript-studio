class DomainError(Exception):
    """Base for errors the controllers translate into HTTP responses."""


class NotFoundError(DomainError):
    pass


class InvalidAudioError(DomainError):
    pass
