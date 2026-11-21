//! Verify Tauri's base64-wrapped Minisign files with an independent verifier.
use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use std::{env, fs, process};

fn decoded_file(path: &str) -> Result<String, String> {
    let text = fs::read_to_string(path).map_err(|_| "Could not read verification input")?;
    let decoded = STANDARD
        .decode(text.trim())
        .map_err(|_| "Invalid Tauri base64 input")?;
    String::from_utf8(decoded).map_err(|_| "Invalid verification input text".into())
}

fn verify() -> Result<(), String> {
    let args: Vec<_> = env::args().skip(1).collect();
    if args.len() != 3 {
        return Err(
            "Usage: panda-updater-verify <public-key-file> <signature-file> <archive>".into(),
        );
    }
    let public_text = decoded_file(&args[0])?;
    let public_line = public_text
        .lines()
        .find(|line| !line.is_empty() && !line.starts_with("untrusted comment:"))
        .ok_or("Public key is missing")?;
    let public_key = PublicKey::from_base64(public_line).map_err(|_| "Invalid public key")?;
    let signature = Signature::decode(&decoded_file(&args[1])?).map_err(|_| "Invalid signature")?;
    let content = fs::read(&args[2]).map_err(|_| "Could not read update archive")?;
    public_key
        .verify(&content, &signature, false)
        .map_err(|_| "Update signature verification failed".into())
}

fn main() {
    match verify() {
        Ok(()) => println!("Update signature verified"),
        Err(error) => {
            eprintln!("{error}");
            process::exit(1);
        }
    }
}
