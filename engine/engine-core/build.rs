use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let scenario_library = manifest_dir.join("scenario_library");
    println!("cargo:rerun-if-changed={}", scenario_library.display());

    let mut scenario_paths = fs::read_dir(&scenario_library)
        .expect("scenario library should be readable")
        .map(|entry| entry.expect("scenario entry should be readable").path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "json")
        })
        .collect::<Vec<_>>();
    scenario_paths.sort();

    let mut generated = String::from(
        "fn embedded_scenarios() -> &'static [(&'static str, &'static str)] {\n    &[\n",
    );
    for path in scenario_paths {
        println!("cargo:rerun-if-changed={}", path.display());
        let label = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .expect("scenario file stem should be valid UTF-8");
        generated.push_str(&format!(
            "        (\"{label}\", include_str!(r#\"{}\"#)),\n",
            path.display()
        ));
    }
    generated.push_str("    ]\n}\n");

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    fs::write(out_dir.join("embedded_scenarios.rs"), generated)
        .expect("embedded scenario source should be writable");
}
