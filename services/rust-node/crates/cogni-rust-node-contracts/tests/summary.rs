use cogni_rust_node_contracts::contract_summary;
use serde_json::Value;
use std::{fs, path::PathBuf};

#[test]
fn contract_summary_matches_fixture() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/generated/node-contracts.summary.json");
    let fixture: Value =
        serde_json::from_str(&fs::read_to_string(path).expect("read contract fixture"))
            .expect("parse contract fixture");
    assert_eq!(contract_summary(), fixture["summary"]);
}
