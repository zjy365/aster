use std::collections::HashMap;
use std::sync::RwLock;

/// Port of src/main/write-safety.ts. Contexts are read-only by default; the
/// renderer can only relax a context, and every write command asserts before
/// forwarding to the core.
#[derive(Default)]
pub struct WriteSafety {
    read_only_by_context: RwLock<HashMap<String, bool>>,
}

impl WriteSafety {
    pub fn set_read_only(&self, context_id: String, read_only: bool) {
        self.read_only_by_context.write().unwrap().insert(context_id, read_only);
    }

    pub fn is_read_only(&self, context_id: &str) -> bool {
        self.read_only_by_context.read().unwrap().get(context_id) != Some(&false)
    }

    pub fn assert_write_allowed(&self, context_id: &str, operation: &str) -> Result<(), String> {
        if self.is_read_only(context_id) {
            return Err(format!("{operation} is blocked while this context is read-only"));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contexts_are_read_only_by_default() {
        let safety = WriteSafety::default();
        assert!(safety.assert_write_allowed("prod", "Pod exec").is_err());
        safety.set_read_only("prod".into(), false);
        assert!(safety.assert_write_allowed("prod", "Pod exec").is_ok());
        safety.set_read_only("prod".into(), true);
        assert!(safety.assert_write_allowed("prod", "Pod exec").is_err());
    }
}
