use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum EngineError {
    #[error("unknown scenario id: {0}")]
    UnknownScenario(String),
    #[error("invalid scenario definition: {0}")]
    InvalidScenario(String),
    #[error("invalid action: {0}")]
    InvalidAction(String),
    #[error("unsupported action: {0}")]
    UnsupportedAction(String),
    #[error("no action available to undo")]
    NothingToUndo,
}
