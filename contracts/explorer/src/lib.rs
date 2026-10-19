#![no_std]

//! Explorer contract for registering contract metadata and persisting decoded
//! Soroban events in a compact on-chain ring buffer.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    Bytes, BytesN, Env, String, Symbol, Vec,
};

mod state;

#[cfg(kani)]
#[path = "../proofs/state_proofs.rs"]
mod state_proofs;

// ── Error codes ──────────────────────────────────────────────────────────────

#[allow(missing_docs)]
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotFound = 1,
    Unauthorized = 2,
    AlreadyExists = 3,
    BelowFloor = 4,
    ContractPaused = 5,
    InvalidInput = 6,
    EmptyBatch = 7,
    AlreadyClaimed = 8,
}

// ── Storage keys ─────────────────────────────────────────────────────────────

/// Composite key used to store historical ABI versions.
#[allow(missing_docs)]
#[contracttype]
#[derive(Clone)]
pub struct VersionKey {
    pub contract_id: BytesN<32>,
    pub abi_version: u32,
}

#[allow(missing_docs)]
#[contracttype]
pub enum DataKey {
    Admin,
    Role(Address),
    Contract(BytesN<32>),
    /// Event log entries use persistent storage so they can be archived and restored.
    /// Keepers must refresh live entries before TTL expiry; restoration of archived
    /// entries requires a RestoreFootprintOp before invoking this contract.
    EventLog(u64),
    EventSeq,
    MaxEvents,
    Paused,
    ContractVersion(VersionKey),
    /// Verified owner of a registry entry (see `claim_contract`).
    Ownership(BytesN<32>),
    /// Admin-attested deployer of a target contract (claim fallback path).
    Deployer(BytesN<32>),
}

#[allow(missing_docs)]
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum Role {
    Moderator,
}

/// Minimum allowed value for `max_events` (prevents accidental data loss).
pub const MIN_MAX_EVENTS: u32 = 1_000;
/// Default ring-buffer capacity used at init when caller passes `0`.
pub const DEFAULT_MAX_EVENTS: u32 = 50_000;
/// Maximum ring-buffer capacity accepted from callers.
pub const MAX_MAX_EVENTS: u32 = 1_000_000;

// ── Input-size limits (anti-bloat / rent DoS protection) ──────────────────────

/// Maximum byte length for a contract or event `name`.
pub const MAX_NAME_LEN: u32 = 64;
/// Maximum byte length for a contract or event `description`.
pub const MAX_DESCRIPTION_LEN: u32 = 512;
/// Maximum number of entries in `ContractMeta.functions`.
pub const MAX_FUNCTIONS: u32 = 50;
/// Maximum byte length for each `ParamDef.name`.
pub const MAX_PARAM_NAME_LEN: u32 = 32;
/// Maximum byte length for each `ParamDef.kind`.
pub const MAX_PARAM_KIND_LEN: u32 = 32;
/// Maximum number of parameters per `FunctionAbi`.
pub const MAX_PARAMS_PER_FUNCTION: u32 = 20;
/// Maximum number of topics accepted for one stored event.
pub const MAX_EVENT_TOPICS: u32 = 32;
/// Maximum byte length of one event topic.
pub const MAX_EVENT_TOPIC_LEN: u32 = 256;
/// Maximum byte length of the raw event payload.
pub const MAX_EVENT_RAW_DATA_LEN: u32 = 4_096;

// ── Batch submission ──────────────────────────────────────────────────────────

/// Maximum number of events accepted by one `submit_events` call.
///
/// Measured by `tests/gas_benchmarks.rs::test_submit_events_batch_benchmark`
/// (soroban-sdk 21 test host, 512-byte descriptions — the per-item worst case
/// allowed by `MAX_DESCRIPTION_LEN`). A single `submit_event` costs ~109K CPU
/// instructions.
///
/// | batch size | CPU instructions | per event | persistent writes |
/// | ---------- | ---------------- | --------- | ----------------- |
/// | 1          | ~108K            | ~108K     | 1 + instance      |
/// | 10         | ~487K            | ~49K      | 10 + instance     |
/// | 20         | ~1.0M            | ~51K      | 20 + instance     |
///
/// CPU is not the constraint (20 items use ~1% of the 100M per-tx instruction
/// limit). The bound is the per-transaction ledger write limits: every item is
/// its own `EventLog` entry of ~0.7KB plus caller-supplied `raw_topics` /
/// `raw_data`, so 20 items keep write entries and write bytes well inside the
/// network limits while leaving headroom for large raw payloads. Re-check the
/// live network settings before raising this value.
pub const MAX_BATCH: u32 = 20;

/// A batch rejected because item `i` is invalid fails with contract error
/// code `BATCH_ITEM_ERROR_BASE + i`, so callers can locate the offending item.
pub const BATCH_ITEM_ERROR_BASE: u32 = 1_000;

// ── Storage TTL ────────────────────────────────────────────────────────────────

/// Approximate ledgers per day at a 5s target close time.
const DAY_IN_LEDGERS: u32 = 17_280;
/// Extend instance storage (admin/paused/event-seq/max-events) once its
/// remaining TTL drops below this many ledgers.
const INSTANCE_TTL_THRESHOLD: u32 = DAY_IN_LEDGERS * 7;
/// ...out to this many ledgers from the current one.
const INSTANCE_TTL_EXTEND_TO: u32 = DAY_IN_LEDGERS * 30;
/// Extend a persistent entry (contract registry, event log slot) once its
/// remaining TTL drops below this many ledgers.
const PERSISTENT_TTL_THRESHOLD: u32 = DAY_IN_LEDGERS * 30;
/// ...out to this many ledgers from the current one.
const PERSISTENT_TTL_EXTEND_TO: u32 = DAY_IN_LEDGERS * 90;

// ── Data types ────────────────────────────────────────────────────────────────

/// ABI-like metadata for a registered contract.
#[allow(missing_docs)]
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ContractMeta {
    /// Schema version for forward compatibility.
    pub version: u32,
    /// Monotonic ABI version; incremented on every `update_contract` call.
    pub abi_version: u32,
    /// Ledger sequence at which this ABI version was written.
    pub min_ledger: u32,
    pub name: String,
    pub description: String,
    pub functions: Vec<FunctionAbi>,
    pub registered_by: Address,
}

#[allow(missing_docs)]
#[contracttype]
#[derive(Clone)]
pub enum StoredMeta {
    V1(ContractMeta),
    V2(ContractMeta),
}

impl StoredMeta {
    pub fn into_latest(self) -> ContractMeta {
        match self {
            StoredMeta::V1(meta) | StoredMeta::V2(meta) => meta,
        }
    }
}

/// Describes one callable function so the explorer can decode calls.
#[allow(missing_docs)]
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct FunctionAbi {
    pub name: Symbol,
    pub description: String,
    pub params: Vec<ParamDef>,
}

/// One parameter definition.
#[allow(missing_docs)]
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ParamDef {
    pub name: Symbol,
    pub kind: Symbol,
}

/// How ownership of a registry entry was proven on-chain.
#[allow(missing_docs)]
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VerifyMethod {
    /// The target contract's `admin()` view returned the claimant.
    TargetAdmin,
    /// The target contract's `owner()` view returned the claimant.
    TargetOwner,
    /// The claimant matches the deployer attested by the explorer admin.
    Deployer,
}

/// Verified ownership of a registry entry. Stored separately from
/// `ContractMeta` so existing registrations keep decoding after an upgrade;
/// entries without one are unverified.
#[allow(missing_docs)]
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Ownership {
    pub owner: Address,
    pub method: VerifyMethod,
    pub ledger: u32,
}

/// A decoded, human-readable event stored on-chain.
#[allow(missing_docs)]
#[contracttype]
#[derive(Clone)]
pub struct DecodedEvent {
    pub seq: u64,
    pub contract_id: BytesN<32>,
    pub function: Symbol,
    pub ledger: u32,
    pub description: String,
    pub raw_topics: Vec<String>,
    pub raw_data: Bytes,
}

/// Event submission parameters.
#[allow(missing_docs)]
#[contracttype]
#[derive(Clone)]
pub struct EventInput {
    pub contract_id: BytesN<32>,
    pub function: Symbol,
    pub ledger: u32,
    pub description: String,
    pub raw_topics: Vec<String>,
    pub raw_data: Bytes,
}

// ── Validation helpers ────────────────────────────────────────────────────────

/// Validate a `ContractMeta` payload against all size limits.
/// Returns `Error::InvalidInput` on the first violation found.
/// Must be called before any storage write in `register_contract` and
/// `update_contract`.
fn validate_meta(meta: &ContractMeta) -> Result<(), Error> {
    if meta.name.len() > MAX_NAME_LEN {
        return Err(Error::InvalidInput);
    }
    if meta.description.len() > MAX_DESCRIPTION_LEN {
        return Err(Error::InvalidInput);
    }
    if meta.functions.len() > MAX_FUNCTIONS {
        return Err(Error::InvalidInput);
    }
    for i in 0..meta.functions.len() {
        let func = meta.functions.get(i).unwrap();
        if func.description.len() > MAX_DESCRIPTION_LEN {
            return Err(Error::InvalidInput);
        }
        if func.params.len() > MAX_PARAMS_PER_FUNCTION {
            return Err(Error::InvalidInput);
        }
        // Note: ParamDef.name and ParamDef.kind are Soroban `Symbol` values.
        // The Soroban SDK already enforces the 32-character limit on Symbol
        // construction, so no additional length check is required here.
    }
    Ok(())
}

/// Validate the `description` field of an `EventInput`.
fn validate_event_description(description: &String) -> Result<(), Error> {
    if description.len() > MAX_DESCRIPTION_LEN {
        return Err(Error::InvalidInput);
    }
    Ok(())
}

/// Validate a single `EventInput` (shared by `submit_event` and `submit_events`).
fn validate_event_input(env: &Env, input: &EventInput) -> Result<(), Error> {
    if input.function == Symbol::new(env, "") {
        return Err(Error::InvalidInput);
    }
    validate_event_description(&input.description)
}

/// CRC16-XModem, used by Stellar strkeys.
fn crc16_xmodem(data: &[u8]) -> u16 {
    let mut crc: u16 = 0;
    for &b in data {
        crc ^= (b as u16) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 {
                (crc << 1) ^ 0x1021
            } else {
                crc << 1
            };
        }
    }
    crc
}

/// Address of the contract with the given 32-byte id (`C...` strkey).
/// soroban-sdk 21 has no public constructor for this, so the strkey is built
/// here; the host validates its checksum.
fn contract_address(env: &Env, contract_id: &BytesN<32>) -> Address {
    const ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut payload = [0u8; 35];
    payload[0] = 2 << 3; // strkey version byte for contracts ('C')
    payload[1..33].copy_from_slice(&contract_id.to_array());
    let crc = crc16_xmodem(&payload[..33]);
    payload[33] = (crc & 0xff) as u8;
    payload[34] = (crc >> 8) as u8;

    // 35 bytes = 280 bits = exactly 56 base32 characters.
    let mut out = [0u8; 56];
    let (mut buf, mut bits, mut o) = (0u32, 0u32, 0usize);
    for b in payload {
        buf = ((buf << 8) | b as u32) & 0xffff;
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out[o] = ALPHABET[((buf >> bits) & 31) as usize];
            o += 1;
        }
    }
    Address::from_string_bytes(&Bytes::from_array(env, &out))
}

/// Calls a zero-argument view on `target` that should return an `Address`.
/// Any failure — missing function, panic, wrong return type, re-entry into the
/// explorer (rejected by the host) — yields `None` instead of aborting.
fn try_view_address(env: &Env, target: &Address, func: &str) -> Option<Address> {
    match env.try_invoke_contract::<Address, soroban_sdk::Error>(
        target,
        &Symbol::new(env, func),
        Vec::new(env),
    ) {
        Ok(Ok(addr)) => Some(addr),
        _ => None,
    }
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[allow(missing_docs)]
#[contract]
pub struct ExplorerContract;

#[contractimpl]
impl ExplorerContract {
    // ── Storage TTL ───────────────────────────────────────────────────────────

    /// Refreshes the instance storage TTL (admin, paused flag, event sequence,
    /// max-events) so it does not archive between calls. Persistent storage
    /// TTLs are extended separately, at the specific keys written.
    fn bump_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
    }

    fn require_admin(env: &Env, caller: &Address) {
        caller.require_auth();
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if caller != &admin {
            panic_with_error!(env, Error::Unauthorized);
        }
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    /// Initialises the explorer and configures the event ring buffer.
    /// Panics with `AlreadyExists` if called more than once.
    /// Pass `max_events = 0` to use the default capacity.
    pub fn init(env: Env, admin: Address, max_events: u32) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyExists);
        }
        let cap = if max_events == 0 {
            DEFAULT_MAX_EVENTS
        } else {
            max_events
        };
        if cap < MIN_MAX_EVENTS || cap > MAX_MAX_EVENTS {
            panic_with_error!(&env, Error::InvalidInput);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::EventSeq, &0u64);
        env.storage().instance().set(&DataKey::MaxEvents, &cap);
        Self::bump_instance_ttl(&env);
    }

    /// Transfer admin rights to a new address (current admin only).
    pub fn transfer_admin(env: Env, caller: Address, new_admin: Address) {
        Self::bump_instance_ttl(&env);
        caller.require_auth();
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if caller != admin {
            panic_with_error!(&env, Error::Unauthorized);
        }
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.events()
            .publish((symbol_short!("adm_xfer"), caller), new_admin);
    }

    /// Grant a delegated role. Only the admin may change roles.
    pub fn grant_role(env: Env, caller: Address, account: Address, role: Role) {
        Self::bump_instance_ttl(&env);
        Self::require_admin(&env, &caller);
        env.storage()
            .instance()
            .set(&DataKey::Role(account.clone()), &role);
        env.events()
            .publish((Symbol::new(&env, "role_grant"), account), role);
    }

    /// Revoke all delegated privileges from an account.
    pub fn revoke_role(env: Env, caller: Address, account: Address) {
        Self::bump_instance_ttl(&env);
        Self::require_admin(&env, &caller);
        env.storage().instance().remove(&DataKey::Role(account.clone()));
        env.events().publish((Symbol::new(&env, "role_revoke"),), account);
    }

    /// Return the delegated role assigned to an account, if any.
    pub fn get_role(env: Env, account: Address) -> Option<Role> {
        env.storage().instance().get(&DataKey::Role(account))
    }

    /// Update the ring-buffer capacity (admin only).
    /// Panics with `BelowFloor` if `new_max < MIN_MAX_EVENTS`.
    /// Panics with `InvalidInput` if the ring buffer has already wrapped
    /// (`event_seq >= current max_events`): `slot = seq % max_events` is
    /// computed against whatever `max_events` is live at call time, so
    /// changing the modulus after any eviction has occurred would desync
    /// historical slot lookups from future ones and orphan old entries.
    /// Resizing is only safe before the buffer has ever wrapped.
    pub fn set_max_events(env: Env, caller: Address, new_max: u32) {
        Self::bump_instance_ttl(&env);
        caller.require_auth();
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if caller != admin {
            panic_with_error!(&env, Error::Unauthorized);
        }
        let seq: u64 = env
            .storage()
            .instance()
            .get(&DataKey::EventSeq)
            .unwrap_or(0);
        let current_max: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxEvents)
            .unwrap_or(DEFAULT_MAX_EVENTS);
        if let Err(e) = state::check_resize(seq, current_max, new_max) {
            panic_with_error!(&env, e);
        }
        env.storage().instance().set(&DataKey::MaxEvents, &new_max);
    }

    /// Returns `(current_event_count, max_events)`.
    pub fn storage_utilisation(env: Env) -> (u64, u32) {
        let seq: u64 = env
            .storage()
            .instance()
            .get(&DataKey::EventSeq)
            .unwrap_or(0);
        let max: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxEvents)
            .unwrap_or(DEFAULT_MAX_EVENTS);
        (state::retained_count(seq, max), max)
    }

    // ── Pause / unpause ───────────────────────────────────────────────────────

    /// Freeze all state-mutating operations (admin only).
    pub fn pause(env: Env, caller: Address) {
        Self::bump_instance_ttl(&env);
        caller.require_auth();
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if caller != admin {
            panic_with_error!(&env, Error::Unauthorized);
        }
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish((symbol_short!("paused"),), ());
    }

    /// Unfreeze the contract (admin only).
    pub fn unpause(env: Env, caller: Address) {
        Self::bump_instance_ttl(&env);
        caller.require_auth();
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if caller != admin {
            panic_with_error!(&env, Error::Unauthorized);
        }
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events().publish((symbol_short!("unpaused"),), ());
    }

    /// Returns whether the contract is currently paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    // ── Contract Registry ─────────────────────────────────────────────────────

    /// Register ABI metadata for a Soroban contract.
    /// Panics with `AlreadyExists` if the contract ID is already registered.
    /// The contract forces `abi_version = 0` and records `min_ledger` on first write.
    pub fn register_contract(
        env: Env,
        caller: Address,
        contract_id: BytesN<32>,
        meta: ContractMeta,
    ) {
        Self::bump_instance_ttl(&env);
        caller.require_auth();
        if let Err(e) = state::ensure_writable(Self::is_paused(env.clone())) {
            panic_with_error!(&env, e);
        }
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if caller != admin {
            panic_with_error!(&env, Error::Unauthorized);
        }
        let key = DataKey::Contract(contract_id.clone());
        if env.storage().persistent().has(&key) {
            panic_with_error!(&env, Error::AlreadyExists);
        }
        if let Err(e) = validate_meta(&meta) {
            panic_with_error!(&env, e);
        }
        let mut stored = meta;
        stored.abi_version = 0;
        stored.min_ledger = env.ledger().sequence();
        env.storage().persistent().set(&key, &stored);
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );
        // Version history entry for abi_version 0.
        let vkey = DataKey::ContractVersion(VersionKey {
            contract_id: contract_id.clone(),
            abi_version: 0,
        });
        env.storage().persistent().set(&vkey, &stored);
        env.storage().persistent().extend_ttl(
            &vkey,
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );

        env.events().publish(
            (symbol_short!("c_reg"), contract_id.clone()),
            (
                stored.registered_by.clone(),
                stored.version,
                env.ledger().sequence(),
            ),
        );
        env.events()
            .publish((symbol_short!("register"), contract_id), stored.name);
    }

    /// Update registered metadata.
    /// Caller must be the admin, original registrant, or a moderator.
    /// `meta.abi_version` must equal `existing.abi_version + 1` (optimistic concurrency guard).
    pub fn update_contract(env: Env, caller: Address, contract_id: BytesN<32>, meta: ContractMeta) {
        Self::bump_instance_ttl(&env);
        caller.require_auth();
        if let Err(e) = state::ensure_writable(Self::is_paused(env.clone())) {
            panic_with_error!(&env, e);
        }
        let key = DataKey::Contract(contract_id.clone());
        let existing: ContractMeta = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotFound));

        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        let ownership: Option<Ownership> = env
            .storage()
            .persistent()
            .get(&DataKey::Ownership(contract_id.clone()));
        if !state::can_update_entry(
            caller == admin,
            caller == existing.registered_by,
            ownership.map(|o| o.owner == caller),
        ) {
            panic_with_error!(&env, Error::Unauthorized);
        }

        // Optimistic concurrency: submitted abi_version must be current + 1.
        if let Err(e) = state::next_abi_version(existing.abi_version, meta.abi_version) {
            panic_with_error!(&env, e);
        }
        if let Err(e) = validate_meta(&meta) {
            panic_with_error!(&env, e);
        }
        let old_abi_version = existing.abi_version;
        let old_version = existing.version;
        let new_abi_version = meta.abi_version;
        let min_ledger = env.ledger().sequence();
        let mut updated = meta;
        updated.min_ledger = min_ledger;
        env.storage().persistent().set(&key, &updated);
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );

        let vkey = DataKey::ContractVersion(VersionKey {
            contract_id: contract_id.clone(),
            abi_version: new_abi_version,
        });
        env.storage().persistent().set(&vkey, &updated);
        env.storage().persistent().extend_ttl(
            &vkey,
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );

        env.events().publish(
            (symbol_short!("c_abiu"), contract_id.clone()),
            (old_abi_version, new_abi_version, min_ledger),
        );
        env.events().publish(
            (symbol_short!("c_upd"), contract_id),
            (
                caller,
                old_version,
                updated.version,
                env.ledger().sequence(),
            ),
        );
    }

    /// Permissionlessly extends the TTL of a registered contract's persistent
    /// storage entry (and its current ABI version entry) so long-lived,
    /// rarely-updated registry entries can stay alive without an admin or
    /// registrant write via `update_contract`.
    ///
    /// This only *extends* TTLs already funded by `register_contract` /
    /// `update_contract` — it writes no new data and requires no auth, so it
    /// cannot be used to grief the registry's storage costs; each caller pays
    /// their own transaction's resource fee for the extension.
    pub fn bump_contract_ttl(env: Env, contract_id: BytesN<32>) {
        Self::bump_instance_ttl(&env);
        let key = DataKey::Contract(contract_id.clone());
        let existing: ContractMeta = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotFound));
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );

        let vkey = DataKey::ContractVersion(VersionKey {
            contract_id,
            abi_version: existing.abi_version,
        });
        env.storage().persistent().extend_ttl(
            &vkey,
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );
    }

    /// Permissionlessly extends a historical ABI snapshot while it is live.
    /// Archived entries must first be restored with a Soroban RestoreFootprintOp.
    pub fn bump_contract_version_ttl(
        env: Env,
        contract_id: BytesN<32>,
        abi_version: u32,
    ) -> Result<(), Error> {
        Self::bump_instance_ttl(&env);
        let key = DataKey::ContractVersion(VersionKey {
            contract_id,
            abi_version,
        });
        if !env.storage().persistent().has(&key) {
            return Err(Error::NotFound);
        }
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );
        Ok(())
    }

    /// Permissionlessly extends a retained event slot while it is live.
    /// Archived entries must first be restored with a Soroban RestoreFootprintOp.
    pub fn bump_event_ttl(env: Env, seq: u64) -> Result<(), Error> {
        Self::bump_instance_ttl(&env);
        let max: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxEvents)
            .unwrap_or(DEFAULT_MAX_EVENTS);
        let key = DataKey::EventLog(seq % (max as u64));
        let Some(event) = env.storage().persistent().get::<DataKey, DecodedEvent>(&key) else {
            return Err(Error::NotFound);
        };
        if event.seq != seq {
            return Err(Error::NotFound);
        }
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );
        Ok(())
    }

    pub fn get_contract(env: Env, contract_id: BytesN<32>) -> Result<ContractMeta, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Contract(contract_id))
            .ok_or(Error::NotFound)
    }

    /// Fetch a specific historical ABI version.
    /// Returns `None` if that version does not exist.
    pub fn get_contract_version(
        env: Env,
        contract_id: BytesN<32>,
        abi_version: u32,
    ) -> Option<ContractMeta> {
        env.storage()
            .persistent()
            .get(&DataKey::ContractVersion(VersionKey {
                contract_id,
                abi_version,
            }))
    }

    /// Alias for `get_contract` — returns the latest metadata.
    pub fn get_latest_contract(env: Env, contract_id: BytesN<32>) -> Option<ContractMeta> {
        env.storage()
            .persistent()
            .get(&DataKey::Contract(contract_id))
    }

    /// Deregister a contract.
    /// Caller must be the admin or the original registrant.
    pub fn deregister_contract(env: Env, caller: Address, contract_id: BytesN<32>) {
        Self::bump_instance_ttl(&env);
        caller.require_auth();
        if let Err(e) = state::ensure_writable(Self::is_paused(env.clone())) {
            panic_with_error!(&env, e);
        }
        let key = DataKey::Contract(contract_id.clone());
        let existing: ContractMeta = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotFound));

        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if !state::can_modify_entry(caller == admin, caller == existing.registered_by) {
            panic_with_error!(&env, Error::Unauthorized);
        }

        env.storage().persistent().remove(&key);
        env.storage()
            .persistent()
            .remove(&DataKey::Ownership(contract_id.clone()));
        env.storage()
            .persistent()
            .remove(&DataKey::Deployer(contract_id.clone()));
        // Remove the version history too, so a later registration of the same
        // id cannot expose the previous owner's ABIs.
        for abi_version in state::versions_to_remove(existing.abi_version) {
            env.storage()
                .persistent()
                .remove(&DataKey::ContractVersion(VersionKey {
                    contract_id: contract_id.clone(),
                    abi_version,
                }));
        }
        env.events().publish(
            (symbol_short!("c_dereg"), contract_id),
            (caller, env.ledger().sequence()),
        );
    }

    // ── Ownership verification (#875) ─────────────────────────────────────────

    /// Records the deployer of `contract_id` as reported by the indexer from
    /// the target's creation transaction (admin only). Used as the fallback
    /// proof path in `claim_contract`.
    pub fn attest_deployer(env: Env, caller: Address, contract_id: BytesN<32>, deployer: Address) {
        Self::bump_instance_ttl(&env);
        caller.require_auth();
        if let Err(e) = state::ensure_writable(Self::is_paused(env.clone())) {
            panic_with_error!(&env, e);
        }
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if caller != admin {
            panic_with_error!(&env, Error::Unauthorized);
        }
        let key = DataKey::Deployer(contract_id);
        env.storage().persistent().set(&key, &deployer);
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );
    }

    /// Proves on-chain ownership of a registered contract and takes over its
    /// registry entry.
    ///
    /// Proof paths, in priority order:
    /// 1. the target's `admin()` (then `owner()`) view returns `claimant`, or
    /// 2. `claimant` is the deployer attested via `attest_deployer`;
    ///
    /// and `claimant` authorizes the call (a contract claimant, e.g. a
    /// multisig, authorizes through its `__check_auth`). The target is called
    /// with a handled try-call, so a missing, panicking or re-entrant view
    /// just falls through to the next path.
    ///
    /// On success the entry's `registered_by` becomes `claimant` (the previous
    /// registrant loses update rights), the claim is stored, and `c_claim` is
    /// emitted with `(claimant, previous_registrant, method)`. An entry can be
    /// claimed once: later claims — including a competing one in the same
    /// ledger, which executes after the first — fail with `AlreadyClaimed`.
    pub fn claim_contract(env: Env, contract_id: BytesN<32>, claimant: Address) -> VerifyMethod {
        Self::bump_instance_ttl(&env);
        if let Err(e) = state::ensure_writable(Self::is_paused(env.clone())) {
            panic_with_error!(&env, e);
        }
        let key = DataKey::Contract(contract_id.clone());
        let mut meta: ContractMeta = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotFound));
        let okey = DataKey::Ownership(contract_id.clone());
        if env.storage().persistent().has(&okey) {
            panic_with_error!(&env, Error::AlreadyClaimed);
        }

        let target = contract_address(&env, &contract_id);
        let deployer: Option<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Deployer(contract_id.clone()));
        let method = if try_view_address(&env, &target, "admin").as_ref() == Some(&claimant) {
            VerifyMethod::TargetAdmin
        } else if try_view_address(&env, &target, "owner").as_ref() == Some(&claimant) {
            VerifyMethod::TargetOwner
        } else if deployer.as_ref() == Some(&claimant) {
            VerifyMethod::Deployer
        } else {
            panic_with_error!(&env, Error::Unauthorized)
        };
        claimant.require_auth();

        let previous = meta.registered_by.clone();
        if previous != claimant {
            meta.registered_by = claimant.clone();
            env.storage().persistent().set(&key, &meta);
        }
        env.storage().persistent().set(
            &okey,
            &Ownership {
                owner: claimant.clone(),
                method,
                ledger: env.ledger().sequence(),
            },
        );
        env.storage().persistent().extend_ttl(
            &okey,
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );

        env.events().publish(
            (symbol_short!("c_claim"), contract_id),
            (claimant, previous, method),
        );
        method
    }

    /// Verified ownership of a registry entry, or `None` if it is unverified.
    pub fn get_ownership(env: Env, contract_id: BytesN<32>) -> Option<Ownership> {
        env.storage()
            .persistent()
            .get(&DataKey::Ownership(contract_id))
    }

    // ── Event Decoder ─────────────────────────────────────────────────────────

    /// Submit a decoded event to the on-chain ring buffer.
    /// Only the admin may call this.
    pub fn submit_event(env: Env, caller: Address, input: EventInput) {
        Self::bump_instance_ttl(&env);
        caller.require_auth();
        if let Err(e) = validate_event_input(&env, &input) {
            panic_with_error!(&env, e);
        }
        if let Err(e) = state::ensure_writable(Self::is_paused(env.clone())) {
            panic_with_error!(&env, e);
        }
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if caller != admin {
            panic_with_error!(&env, Error::Unauthorized);
        }

        let seq: u64 = env
            .storage()
            .instance()
            .get(&DataKey::EventSeq)
            .unwrap_or(0);
        let max: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxEvents)
            .unwrap_or(DEFAULT_MAX_EVENTS);

        let next = state::reserve_seqs(seq, 1).unwrap_or_else(|e| panic_with_error!(&env, e));
        Self::store_event(&env, seq, max, input);
        env.storage().instance().set(&DataKey::EventSeq, &next);
    }

    /// Submit a batch of decoded events in one invocation (admin only).
    ///
    /// Semantics are **all-or-nothing**: every item is validated exactly like
    /// `submit_event` before anything is written, and any failure reverts the
    /// whole batch. An invalid item at index `i` fails with contract error code
    /// `BATCH_ITEM_ERROR_BASE + i`.
    ///
    /// - Empty `inputs` → `EmptyBatch`.
    /// - More than `MAX_BATCH` items, or more items than `max_events` (the batch
    ///   would evict its own entries from the ring buffer) → `InvalidInput`.
    /// - Paused → `ContractPaused` for the whole batch.
    ///
    /// Sequence numbers are assigned contiguously (gap-free) and returned in
    /// input order. The event counter is written once per batch.
    pub fn submit_events(env: Env, caller: Address, inputs: Vec<EventInput>) -> Vec<u64> {
        Self::bump_instance_ttl(&env);
        caller.require_auth();
        if let Err(e) = state::ensure_writable(Self::is_paused(env.clone())) {
            panic_with_error!(&env, e);
        }
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if caller != admin {
            panic_with_error!(&env, Error::Unauthorized);
        }

        let count = inputs.len();
        let max: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxEvents)
            .unwrap_or(DEFAULT_MAX_EVENTS);
        if let Err(e) = state::check_batch(count, max) {
            panic_with_error!(&env, e);
        }
        for i in 0..count {
            if validate_event_input(&env, &inputs.get_unchecked(i)).is_err() {
                panic_with_error!(
                    &env,
                    soroban_sdk::Error::from_contract_error(BATCH_ITEM_ERROR_BASE + i)
                );
            }
        }

        let first: u64 = env
            .storage()
            .instance()
            .get(&DataKey::EventSeq)
            .unwrap_or(0);
        let next = state::reserve_seqs(first, count).unwrap_or_else(|e| panic_with_error!(&env, e));
        let mut seqs: Vec<u64> = Vec::new(&env);
        for (seq, input) in (first..next).zip(inputs.iter()) {
            Self::store_event(&env, seq, max, input);
            seqs.push_back(seq);
        }
        env.storage().instance().set(&DataKey::EventSeq, &next);

        env.events()
            .publish((symbol_short!("ev_batch"),), (first, count));
        seqs
    }

    /// Writes one event into its ring-buffer slot and emits the per-event
    /// diagnostics (`ev_sub`, `cap_hit`, `decoded`). Does not touch `EventSeq`.
    fn store_event(env: &Env, seq: u64, max: u32, input: EventInput) {
        let slot = state::ring_slot(seq, max);

        let event = DecodedEvent {
            seq,
            contract_id: input.contract_id.clone(),
            function: input.function.clone(),
            ledger: input.ledger,
            description: input.description.clone(),
            raw_topics: input.raw_topics,
            raw_data: input.raw_data,
        };
        let event_key = DataKey::EventLog(slot);
        env.storage().persistent().set(&event_key, &event);
        env.storage().persistent().extend_ttl(
            &event_key,
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );

        env.events().publish(
            (
                symbol_short!("ev_sub"),
                input.contract_id.clone(),
                input.function.clone(),
            ),
            (seq, input.ledger),
        );
        if let Some(evicted_seq) = state::evicted_seq(seq, max) {
            env.events()
                .publish((symbol_short!("cap_hit"),), (evicted_seq, seq));
        }
        env.events().publish(
            (symbol_short!("decoded"), input.contract_id, input.function),
            input.description,
        );
    }

    /// Fetch a single decoded event by sequence number.
    /// Panics with `NotFound` if the sequence is outside the live ring window.
    pub fn get_event(env: Env, seq: u64) -> DecodedEvent {
        let max: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxEvents)
            .unwrap_or(DEFAULT_MAX_EVENTS);
        let slot = state::ring_slot(seq, max);
        let stored: DecodedEvent = env
            .storage()
            .persistent()
            .get(&DataKey::EventLog(slot))
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotFound));
        // Verify the slot still holds the requested seq (not overwritten by ring wrap).
        if stored.seq != seq {
            panic_with_error!(&env, Error::NotFound);
        }
        stored
    }

    /// Returns the number of events currently retained (≤ `max_events`).
    pub fn event_count(env: Env) -> u64 {
        let seq: u64 = env
            .storage()
            .instance()
            .get(&DataKey::EventSeq)
            .unwrap_or(0);
        let max: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxEvents)
            .unwrap_or(DEFAULT_MAX_EVENTS);
        state::retained_count(seq, max)
    }

    /// Fetch a page of decoded events starting from `cursor`.
    /// Returns at most `limit` events. Skips events evicted from the ring buffer.
    pub fn get_events(env: Env, cursor: u64, limit: u32) -> Vec<DecodedEvent> {
        let total_seq: u64 = env
            .storage()
            .instance()
            .get(&DataKey::EventSeq)
            .unwrap_or(0);
        let max: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxEvents)
            .unwrap_or(DEFAULT_MAX_EVENTS);
        let oldest = state::oldest_retained(total_seq, max);
        let start = cursor.max(oldest);
        let mut out: Vec<DecodedEvent> = Vec::new(&env);
        let mut seq = start;
        while out.len() < limit && seq < total_seq {
            let slot = state::ring_slot(seq, max);
            if let Some(ev) = env
                .storage()
                .persistent()
                .get::<DataKey, DecodedEvent>(&DataKey::EventLog(slot))
            {
                if ev.seq == seq {
                    out.push_back(ev);
                }
            }
            seq += 1;
        }
        out
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events as _},
        Env,
    };

    fn setup() -> (Env, ExplorerContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, ExplorerContract);
        let client = ExplorerContractClient::new(&env, &id);
        (env, client)
    }

    fn make_input(env: &Env, cid: &BytesN<32>) -> EventInput {
        EventInput {
            contract_id: cid.clone(),
            function: symbol_short!("swap"),
            ledger: 100u32,
            description: String::from_str(env, "test"),
            raw_topics: Vec::new(env),
            raw_data: Bytes::new(env),
        }
    }

    fn make_meta(env: &Env, name: &str, registrant: &Address) -> ContractMeta {
        ContractMeta {
            version: 1,
            abi_version: 0,
            min_ledger: 0,
            name: String::from_str(env, name),
            description: String::from_str(env, "desc"),
            functions: Vec::new(env),
            registered_by: registrant.clone(),
        }
    }

    // ── Basic init + register ─────────────────────────────────────────────────

    #[test]
    fn test_init_and_register() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[1u8; 32]);
        client.register_contract(&admin, &cid, &make_meta(&env, "StellarSwap", &admin));
        let fetched = client.get_contract(&cid);
        assert_eq!(fetched.name, String::from_str(&env, "StellarSwap"));
    }

    #[test]
    #[should_panic]
    fn test_register_unauthorized() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let stranger = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[50u8; 32]);
        client.register_contract(
            &stranger,
            &cid,
            &make_meta(&env, "UnauthorizedReg", &stranger),
        );
    }

    #[test]
    fn test_submit_and_get_event() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[2u8; 32]);
        let input = EventInput {
            contract_id: cid.clone(),
            function: symbol_short!("swap"),
            ledger: 4521983u32,
            description: String::from_str(&env, "Address GABC... swapped 100 USDC"),
            raw_topics: Vec::new(&env),
            raw_data: Bytes::new(&env),
        };
        client.submit_event(&admin, &input);

        assert_eq!(client.event_count(), 1u64);
        let ev = client.get_event(&0u64);
        assert_eq!(ev.ledger, 4521983u32);
    }

    #[test]
    fn test_cursor_pagination() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[3u8; 32]);
        let base = make_input(&env, &cid);

        for _ in 0..5 {
            client.submit_event(&admin, &base);
        }
        assert_eq!(client.event_count(), 5u64);

        let page1 = client.get_events(&0u64, &2u32);
        assert_eq!(page1.len(), 2);
        assert_eq!(page1.get(0).unwrap().seq, 0);
        assert_eq!(page1.get(1).unwrap().seq, 1);

        let page2 = client.get_events(&2u64, &2u32);
        assert_eq!(page2.len(), 2);
        assert_eq!(page2.get(0).unwrap().seq, 2);

        let page3 = client.get_events(&4u64, &2u32);
        assert_eq!(page3.len(), 1);
        assert_eq!(page3.get(0).unwrap().seq, 4);

        let empty = client.get_events(&10u64, &5u32);
        assert_eq!(empty.len(), 0);
    }

    // Boundary check for `get_events`: a page requested from the middle of the
    // log must honour both the `start` offset and the `limit` cap, returning
    // exactly `min(limit, total - start)` events beginning at `start`.
    #[test]
    fn test_get_events_pagination() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[4u8; 32]);
        let base = make_input(&env, &cid);

        for _ in 0..5 {
            client.submit_event(&admin, &base);
        }
        assert_eq!(client.event_count(), 5u64);

        // start = 2, limit = 2 -> events with seq 2 and 3.
        let page = client.get_events(&2u64, &2u32);
        assert_eq!(page.len(), 2);
        assert_eq!(page.get(0).unwrap().seq, 2);
        assert_eq!(page.get(1).unwrap().seq, 3);
    }

    #[test]
    #[should_panic]
    fn test_double_init_panics() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);
        client.init(&admin, &0u32);
    }

    // ── Batched submission (#872) ─────────────────────────────────────────────

    fn batch_of(env: &Env, n: u32) -> Vec<EventInput> {
        let cid: BytesN<32> = BytesN::from_array(env, &[5u8; 32]);
        let mut inputs = Vec::new(env);
        for _ in 0..n {
            inputs.push_back(make_input(env, &cid));
        }
        inputs
    }

    #[test]
    fn test_submit_events_assigns_gap_free_seqs() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        client.submit_event(
            &admin,
            &make_input(&env, &BytesN::from_array(&env, &[5u8; 32])),
        );
        let seqs = client.submit_events(&admin, &batch_of(&env, 3));
        assert_eq!(seqs, Vec::from_array(&env, [1u64, 2, 3]));
        assert_eq!(client.event_count(), 4);
        for seq in 0..4u64 {
            assert_eq!(client.get_event(&seq).seq, seq);
        }

        let next = client.submit_events(&admin, &batch_of(&env, 2));
        assert_eq!(next, Vec::from_array(&env, [4u64, 5]));
    }

    #[test]
    fn test_submit_events_max_batch_accepted() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);
        let seqs = client.submit_events(&admin, &batch_of(&env, MAX_BATCH));
        assert_eq!(seqs.len(), MAX_BATCH);
        assert_eq!(client.event_count(), MAX_BATCH as u64);
    }

    #[test]
    fn test_submit_events_empty_batch_rejected() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);
        assert_eq!(
            client.try_submit_events(&admin, &Vec::new(&env)),
            Err(Ok(soroban_sdk::Error::from_contract_error(
                Error::EmptyBatch as u32
            )))
        );
    }

    #[test]
    fn test_submit_events_over_max_batch_rejected() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);
        assert!(client
            .try_submit_events(&admin, &batch_of(&env, MAX_BATCH + 1))
            .is_err());
        assert_eq!(client.event_count(), 0);
    }

    #[test]
    fn test_submit_events_crossing_max_events_reverts() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &MIN_MAX_EVENTS);
        assert!(client
            .try_submit_events(&admin, &batch_of(&env, MAX_BATCH + 1))
            .is_err());
        assert_eq!(client.event_count(), 0);
    }

    #[test]
    fn test_submit_events_invalid_item_reports_index_and_reverts() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let mut inputs = batch_of(&env, 4);
        let mut bad = inputs.get(2).unwrap();
        bad.description = String::from_bytes(&env, &[b'a'; 513]);
        inputs.set(2, bad);

        assert_eq!(
            client.try_submit_events(&admin, &inputs),
            Err(Ok(soroban_sdk::Error::from_contract_error(
                BATCH_ITEM_ERROR_BASE + 2
            )))
        );
        assert_eq!(client.event_count(), 0);
    }

    #[test]
    fn test_submit_events_duplicates_are_distinct_events() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);
        let seqs = client.submit_events(&admin, &batch_of(&env, 2));
        assert_eq!(seqs.len(), 2);
        assert_eq!(client.event_count(), 2);
    }

    #[test]
    #[should_panic]
    fn test_submit_events_paused_rejected() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);
        client.pause(&admin);
        client.submit_events(&admin, &batch_of(&env, 1));
    }

    #[test]
    #[should_panic]
    fn test_submit_events_non_admin_rejected() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let stranger = Address::generate(&env);
        client.init(&admin, &0u32);
        client.submit_events(&stranger, &batch_of(&env, 1));
    }

    // ── Ownership claims (#875) ───────────────────────────────────────────────

    mod targets {
        pub mod with_admin {
            use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env};

            /// Target exposing `admin()`.
            #[contract]
            pub struct WithAdmin;
            #[contractimpl]
            impl WithAdmin {
                pub fn set_admin(env: Env, admin: Address) {
                    env.storage()
                        .instance()
                        .set(&symbol_short!("admin"), &admin);
                }
                pub fn admin(env: Env) -> Address {
                    env.storage()
                        .instance()
                        .get(&symbol_short!("admin"))
                        .unwrap()
                }
            }
        }

        pub mod without_admin {
            use soroban_sdk::{contract, contractimpl};

            /// Target without `admin()` / `owner()`.
            #[contract]
            pub struct WithoutAdmin;
            #[contractimpl]
            impl WithoutAdmin {
                pub fn ping() -> u32 {
                    1
                }
            }
        }

        pub mod panicking_admin {
            use soroban_sdk::{contract, contractimpl, Address, Env};

            /// Target whose `admin()` panics.
            #[contract]
            pub struct PanickingAdmin;
            #[contractimpl]
            impl PanickingAdmin {
                pub fn admin(_env: Env) -> Address {
                    panic!("admin() is broken")
                }
            }
        }

        pub mod reentrant_admin {
            use soroban_sdk::{contract, contractimpl, symbol_short, Address, BytesN, Env};

            /// Target whose `admin()` re-enters the explorer to claim itself.
            #[contract]
            pub struct ReentrantAdmin;
            #[contractimpl]
            impl ReentrantAdmin {
                pub fn set_explorer(env: Env, explorer: Address, cid: BytesN<32>) {
                    env.storage()
                        .instance()
                        .set(&symbol_short!("exp"), &explorer);
                    env.storage().instance().set(&symbol_short!("cid"), &cid);
                }
                pub fn admin(env: Env) -> Address {
                    let explorer: Address =
                        env.storage().instance().get(&symbol_short!("exp")).unwrap();
                    let cid: BytesN<32> =
                        env.storage().instance().get(&symbol_short!("cid")).unwrap();
                    let me = env.current_contract_address();
                    crate::ExplorerContractClient::new(&env, &explorer).claim_contract(&cid, &me);
                    me
                }
            }
        }

        pub use panicking_admin::PanickingAdmin;
        pub use reentrant_admin::{ReentrantAdmin, ReentrantAdminClient};
        pub use with_admin::{WithAdmin, WithAdminClient};
        pub use without_admin::WithoutAdmin;
    }

    /// Registers `cid` in the explorer with `registrant` as owner.
    fn register_as(
        env: &Env,
        client: &ExplorerContractClient,
        admin: &Address,
        cid: &BytesN<32>,
        registrant: &Address,
    ) {
        client.register_contract(admin, cid, &make_meta(env, "Target", registrant));
    }

    /// Contract error code returned by a failed `try_claim_contract`.
    fn claim_err<T, C: core::fmt::Debug>(
        res: Result<Result<T, C>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>>,
    ) -> Error {
        let Err(Ok(e)) = res else {
            panic!("expected a contract error");
        };
        match e.get_code() {
            1 => Error::NotFound,
            2 => Error::Unauthorized,
            5 => Error::ContractPaused,
            8 => Error::AlreadyClaimed,
            code => panic!("unexpected error code {code}"),
        }
    }

    #[test]
    fn test_contract_address_round_trips_host_strkey() {
        let env = Env::default();
        let real = env.register_contract(None, targets::WithoutAdmin);

        // Decode the host's `C...` strkey back to the 32-byte contract id.
        let strkey = real.to_string();
        let mut chars = [0u8; 56];
        strkey.copy_into_slice(&mut chars);
        let (mut buf, mut bits, mut raw) = (0u32, 0u32, [0u8; 35]);
        let mut o = 0;
        for c in chars {
            let v = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
                .iter()
                .position(|&x| x == c)
                .unwrap() as u32;
            buf = ((buf << 5) | v) & 0xffff;
            bits += 5;
            if bits >= 8 {
                bits -= 8;
                raw[o] = (buf >> bits) as u8;
                o += 1;
            }
        }
        let mut id = [0u8; 32];
        id.copy_from_slice(&raw[1..33]);

        assert_eq!(contract_address(&env, &BytesN::from_array(&env, &id)), real);
    }

    #[test]
    fn test_squatter_loses_update_rights_after_admin_claim() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);
        let squatter = Address::generate(&env);
        let owner = Address::generate(&env);

        let cid: BytesN<32> = BytesN::from_array(&env, &[80u8; 32]);
        env.register_contract(&contract_address(&env, &cid), targets::WithAdmin);
        targets::WithAdminClient::new(&env, &contract_address(&env, &cid)).set_admin(&owner);

        register_as(&env, &client, &admin, &cid, &squatter);
        assert!(client.get_ownership(&cid).is_none());

        assert_eq!(
            client.claim_contract(&cid, &owner),
            VerifyMethod::TargetAdmin
        );
        let ownership = client.get_ownership(&cid).unwrap();
        assert_eq!(ownership.owner, owner);
        assert_eq!(client.get_contract(&cid).registered_by, owner);

        let update = ContractMeta {
            abi_version: 1,
            ..make_meta(&env, "Poisoned", &squatter)
        };
        assert!(client
            .try_update_contract(&squatter, &cid, &update)
            .is_err());
        // Verified entries are not editable by the explorer admin either.
        assert!(client.try_update_contract(&admin, &cid, &update).is_err());
        client.update_contract(
            &owner,
            &cid,
            &ContractMeta {
                abi_version: 1,
                ..make_meta(&env, "Real", &owner)
            },
        );
        assert_eq!(
            client.get_contract(&cid).name,
            String::from_str(&env, "Real")
        );
    }

    #[test]
    fn test_claim_requires_claimant_auth() {
        let env = Env::default();
        let id = env.register_contract(None, ExplorerContract);
        let client = ExplorerContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        let owner = Address::generate(&env);
        env.mock_all_auths();
        client.init(&admin, &0u32);
        let cid: BytesN<32> = BytesN::from_array(&env, &[81u8; 32]);
        env.register_contract(&contract_address(&env, &cid), targets::WithAdmin);
        targets::WithAdminClient::new(&env, &contract_address(&env, &cid)).set_admin(&owner);
        register_as(&env, &client, &admin, &cid, &admin);

        env.set_auths(&[]);
        assert!(client.try_claim_contract(&cid, &owner).is_err());
    }

    #[test]
    fn test_claim_without_admin_view_falls_back_to_deployer() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);
        let deployer = Address::generate(&env);
        let cid: BytesN<32> = BytesN::from_array(&env, &[82u8; 32]);
        env.register_contract(&contract_address(&env, &cid), targets::WithoutAdmin);
        register_as(&env, &client, &admin, &cid, &admin);

        // No admin() and no attestation → stays unverified.
        assert_eq!(
            claim_err(client.try_claim_contract(&cid, &deployer)),
            Error::Unauthorized
        );
        assert!(client.get_ownership(&cid).is_none());

        client.attest_deployer(&admin, &cid, &deployer);
        assert_eq!(
            client.claim_contract(&cid, &deployer),
            VerifyMethod::Deployer
        );
    }

    #[test]
    fn test_claim_with_panicking_admin_is_handled() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);
        let deployer = Address::generate(&env);
        let cid: BytesN<32> = BytesN::from_array(&env, &[83u8; 32]);
        env.register_contract(&contract_address(&env, &cid), targets::PanickingAdmin);
        register_as(&env, &client, &admin, &cid, &admin);

        assert_eq!(
            claim_err(client.try_claim_contract(&cid, &deployer)),
            Error::Unauthorized
        );
        client.attest_deployer(&admin, &cid, &deployer);
        assert_eq!(
            client.claim_contract(&cid, &deployer),
            VerifyMethod::Deployer
        );
    }

    #[test]
    fn test_claim_with_reentrant_admin_is_handled() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);
        let cid: BytesN<32> = BytesN::from_array(&env, &[84u8; 32]);
        let target = contract_address(&env, &cid);
        env.register_contract(&target, targets::ReentrantAdmin);
        targets::ReentrantAdminClient::new(&env, &target).set_explorer(&client.address, &cid);
        register_as(&env, &client, &admin, &cid, &admin);

        // Re-entry is rejected by the host, so the view yields nothing and
        // the target cannot claim itself.
        assert_eq!(
            claim_err(client.try_claim_contract(&cid, &target)),
            Error::Unauthorized
        );
        assert!(client.get_ownership(&cid).is_none());
    }

    #[test]
    fn test_second_claim_fails_with_already_claimed() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);
        let owner = Address::generate(&env);
        let cid: BytesN<32> = BytesN::from_array(&env, &[85u8; 32]);
        env.register_contract(&contract_address(&env, &cid), targets::WithAdmin);
        targets::WithAdminClient::new(&env, &contract_address(&env, &cid)).set_admin(&owner);
        register_as(&env, &client, &admin, &cid, &admin);

        client.claim_contract(&cid, &owner);
        assert_eq!(
            claim_err(client.try_claim_contract(&cid, &owner)),
            Error::AlreadyClaimed
        );
    }

    #[test]
    fn test_claim_unregistered_and_paused() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);
        let owner = Address::generate(&env);
        let cid: BytesN<32> = BytesN::from_array(&env, &[86u8; 32]);
        assert_eq!(
            claim_err(client.try_claim_contract(&cid, &owner)),
            Error::NotFound
        );

        register_as(&env, &client, &admin, &cid, &admin);
        client.pause(&admin);
        assert_eq!(
            claim_err(client.try_claim_contract(&cid, &owner)),
            Error::ContractPaused
        );
    }

    #[test]
    #[should_panic]
    fn test_attest_deployer_admin_only() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let stranger = Address::generate(&env);
        client.init(&admin, &0u32);
        let cid: BytesN<32> = BytesN::from_array(&env, &[87u8; 32]);
        client.attest_deployer(&stranger, &cid, &stranger);
    }

    #[test]
    fn test_deregister_clears_ownership() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);
        let deployer = Address::generate(&env);
        let cid: BytesN<32> = BytesN::from_array(&env, &[88u8; 32]);
        register_as(&env, &client, &admin, &cid, &admin);
        client.attest_deployer(&admin, &cid, &deployer);
        client.claim_contract(&cid, &deployer);

        client.deregister_contract(&deployer, &cid);
        assert!(client.get_ownership(&cid).is_none());
        register_as(&env, &client, &admin, &cid, &admin);
        assert!(client.get_ownership(&cid).is_none());
        assert_eq!(
            claim_err(client.try_claim_contract(&cid, &deployer)),
            Error::Unauthorized
        );
    }

    // ── Ring buffer ───────────────────────────────────────────────────────────

    #[test]
    fn test_ring_buffer_wraps_correctly() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &MIN_MAX_EVENTS);
        let cid: BytesN<32> = BytesN::from_array(&env, &[10u8; 32]);
        let base = make_input(&env, &cid);

        env.budget().reset_unlimited();
        for _ in 0..MIN_MAX_EVENTS {
            client.submit_event(&admin, &base);
        }
        assert_eq!(client.event_count(), MIN_MAX_EVENTS as u64);

        for _ in 0..10 {
            client.submit_event(&admin, &base);
        }
        assert_eq!(client.event_count(), MIN_MAX_EVENTS as u64);

        let evs = client.get_events(&0u64, &20u32);
        assert_eq!(evs.len(), 20);
        assert_eq!(evs.get(0).unwrap().seq, 10);
        assert_eq!(evs.get(19).unwrap().seq, 29);
    }

    #[test]
    fn test_storage_utilisation() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &1000u32);
        let (cur, max) = client.storage_utilisation();
        assert_eq!(cur, 0u64);
        assert_eq!(max, 1000u32);
    }

    // ── set_max_events ────────────────────────────────────────────────────────

    #[test]
    #[should_panic]
    fn test_set_max_events_below_floor_rejected() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);
        client.set_max_events(&admin, &999u32);
    }

    #[test]
    fn test_set_max_events_accepted() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);
        client.set_max_events(&admin, &1000u32);
        let (_, max) = client.storage_utilisation();
        assert_eq!(max, 1000u32);
    }

    // ── Diagnostic events (#275) ──────────────────────────────────────────────

    #[test]
    fn test_register_emits_event() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[20u8; 32]);
        client.register_contract(&admin, &cid, &make_meta(&env, "TestDex", &admin));
        assert!(env.events().all().len() >= 2);
    }

    #[test]
    fn test_update_emits_event() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[21u8; 32]);
        let meta_v0 = make_meta(&env, "Dex", &admin);
        client.register_contract(&admin, &cid, &meta_v0);
        let before = env.events().all().len();

        let meta_v1 = ContractMeta {
            version: 2,
            abi_version: 1, // must be existing (0) + 1
            ..meta_v0
        };
        client.update_contract(&admin, &cid, &meta_v1);
        assert!(env.events().all().len() > before);
    }

    #[test]
    fn test_update_contract_by_owner() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let owner = Address::generate(&env);
        let cid: BytesN<32> = BytesN::from_array(&env, &[25u8; 32]);
        // Only the admin can register; meta.registered_by marks the owner for future updates.
        let meta_v0 = make_meta(&env, "MyContract", &owner);
        client.register_contract(&admin, &cid, &meta_v0);

        let meta_v1 = ContractMeta {
            version: 2,
            abi_version: 1, // must be existing (0) + 1
            ..meta_v0
        };
        client.update_contract(&owner, &cid, &meta_v1);

        let updated = client.get_contract(&cid);
        assert_eq!(updated.version, 2);
        assert_eq!(updated.abi_version, 1);
    }

    #[test]
    fn test_submit_emits_ev_sub_event() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[22u8; 32]);
        client.submit_event(&admin, &make_input(&env, &cid));
        assert!(env.events().all().len() >= 2);
    }

    #[test]
    fn test_cap_hit_event_emitted_on_eviction() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &MIN_MAX_EVENTS);
        let cid: BytesN<32> = BytesN::from_array(&env, &[23u8; 32]);
        let base = make_input(&env, &cid);

        env.budget().reset_unlimited();
        for _ in 0..MIN_MAX_EVENTS {
            client.submit_event(&admin, &base);
        }
        let before = env.events().all().len();
        client.submit_event(&admin, &base);
        assert!(env.events().all().len() > before);
    }

    // ── ABI versioning (#272) ─────────────────────────────────────────────────

    #[test]
    fn test_register_sets_version_zero() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[30u8; 32]);
        let meta = ContractMeta {
            abi_version: 99, // contract overwrites to 0
            ..make_meta(&env, "Test", &admin)
        };
        client.register_contract(&admin, &cid, &meta);

        let fetched = client.get_contract(&cid);
        assert_eq!(fetched.abi_version, 0);

        let v0 = client.get_contract_version(&cid, &0u32).unwrap();
        assert_eq!(v0.abi_version, 0);
        assert_eq!(v0.name, String::from_str(&env, "Test"));
    }

    #[test]
    fn test_sequential_updates_increment_abi_version() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[31u8; 32]);
        let meta_v0 = make_meta(&env, "App", &admin);
        client.register_contract(&admin, &cid, &meta_v0);

        let meta_v1 = ContractMeta {
            abi_version: 1,
            ..meta_v0.clone()
        };
        client.update_contract(&admin, &cid, &meta_v1);
        assert_eq!(client.get_contract(&cid).abi_version, 1);

        let meta_v2 = ContractMeta {
            abi_version: 2,
            ..meta_v0
        };
        client.update_contract(&admin, &cid, &meta_v2);
        assert_eq!(client.get_contract(&cid).abi_version, 2);

        assert!(client.get_contract_version(&cid, &0u32).is_some());
        assert!(client.get_contract_version(&cid, &1u32).is_some());
        assert!(client.get_contract_version(&cid, &2u32).is_some());
        assert!(client.get_contract_version(&cid, &3u32).is_none());
    }

    #[test]
    #[should_panic]
    fn test_stale_write_rejected() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[32u8; 32]);
        let meta_v0 = make_meta(&env, "X", &admin);
        client.register_contract(&admin, &cid, &meta_v0);

        let meta_v1 = ContractMeta {
            abi_version: 1,
            ..meta_v0.clone()
        };
        client.update_contract(&admin, &cid, &meta_v1);

        // abi_version 1 again — should panic (expected 2)
        let meta_stale = ContractMeta {
            abi_version: 1,
            ..meta_v0
        };
        client.update_contract(&admin, &cid, &meta_stale);
    }

    #[test]
    fn test_get_contract_not_found() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[33u8; 32]);
        assert!(matches!(
            client.try_get_contract(&cid),
            Err(Ok(crate::Error::NotFound))
        ));
    }

    #[test]
    fn test_bump_contract_ttl_extends_existing_entry() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[40u8; 32]);
        let meta = make_meta(&env, "Test", &admin);
        client.register_contract(&admin, &cid, &meta);

        // Permissionless: no auth mock needed beyond the registration above.
        client.bump_contract_ttl(&cid);

        let fetched = client.get_contract(&cid);
        assert_eq!(fetched.name, String::from_str(&env, "Test"));
    }

    #[test]
    #[should_panic]
    fn test_bump_contract_ttl_missing_contract_panics() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[41u8; 32]);
        client.bump_contract_ttl(&cid);
    }

    #[test]
    fn test_get_latest_contract_returns_none_for_missing() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[33u8; 32]);
        assert!(client.get_latest_contract(&cid).is_none());
        assert!(client.get_contract_version(&cid, &0u32).is_none());
    }

    // ── Deregistration (#271) ─────────────────────────────────────────────────

    #[test]
    fn test_admin_deregisters_contract() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[40u8; 32]);
        client.register_contract(&admin, &cid, &make_meta(&env, "ToRemove", &admin));
        assert!(client.try_get_contract(&cid).is_ok());

        client.deregister_contract(&admin, &cid);
        assert!(client.try_get_contract(&cid).is_err());
    }

    #[test]
    fn test_registrant_deregisters_contract() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let registrant = Address::generate(&env);
        let cid: BytesN<32> = BytesN::from_array(&env, &[41u8; 32]);
        client.register_contract(&admin, &cid, &make_meta(&env, "RegOwned", &registrant));
        client.deregister_contract(&registrant, &cid);
        assert!(client.try_get_contract(&cid).is_err());
    }

    #[test]
    #[should_panic]
    fn test_stranger_cannot_deregister() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let registrant = Address::generate(&env);
        let stranger = Address::generate(&env);
        let cid: BytesN<32> = BytesN::from_array(&env, &[42u8; 32]);
        client.register_contract(&admin, &cid, &make_meta(&env, "Secure", &registrant));
        client.deregister_contract(&stranger, &cid);
    }

    #[test]
    #[should_panic]
    fn test_deregister_missing_id_panics() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[99u8; 32]);
        client.deregister_contract(&admin, &cid);
    }

    #[test]
    fn test_moderator_can_deregister_but_cannot_pause() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, ExplorerContract);
        let client = ExplorerContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        let moderator = Address::generate(&env);
        let cid = BytesN::from_array(&env, &[13; 32]);

        client.init(&admin, &1000u32);
        client.grant_role(&admin, &moderator, &Role::Moderator);
        client.register_contract(&admin, &cid, &make_meta(&env, "Moderated", &admin));
        client.deregister_contract(&moderator, &cid);
        assert!(client.get_latest_contract(&cid).is_none());
        assert!(client.try_pause(&moderator).is_err());
    }

    #[test]
    fn test_deregister_emits_event() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[43u8; 32]);
        client.register_contract(&admin, &cid, &make_meta(&env, "EventTest", &admin));
        let before = env.events().all().len();
        client.deregister_contract(&admin, &cid);
        assert!(env.events().all().len() > before);
    }

    // ── transfer_admin ────────────────────────────────────────────────────────

    #[test]
    fn test_transfer_admin_success() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let new_admin = Address::generate(&env);
        client.init(&admin, &0u32);
        client.transfer_admin(&admin, &new_admin);

        let cid: BytesN<32> = BytesN::from_array(&env, &[9u8; 32]);
        client.submit_event(
            &new_admin,
            &EventInput {
                contract_id: cid,
                function: symbol_short!("ping"),
                ledger: 1u32,
                description: String::from_str(&env, "new admin test"),
                raw_topics: Vec::new(&env),
                raw_data: Bytes::new(&env),
            },
        );
        assert_eq!(client.event_count(), 1u64);
    }

    #[test]
    #[should_panic]
    fn test_transfer_admin_unauthorized() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let new_admin = Address::generate(&env);
        client.init(&admin, &0u32);
        client.transfer_admin(&attacker, &new_admin);
    }

    #[test]
    #[should_panic]
    fn test_old_admin_loses_access_after_transfer() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let new_admin = Address::generate(&env);
        client.init(&admin, &0u32);
        client.transfer_admin(&admin, &new_admin);

        let cid: BytesN<32> = BytesN::from_array(&env, &[10u8; 32]);
        client.submit_event(
            &admin,
            &EventInput {
                contract_id: cid,
                function: symbol_short!("ping"),
                ledger: 1u32,
                description: String::from_str(&env, "stale admin attempt"),
                raw_topics: Vec::new(&env),
                raw_data: Bytes::new(&env),
            },
        );
    }

    #[test]
    fn test_transfer_admin_to_self_is_noop() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);
        client.transfer_admin(&admin, &admin);

        let cid: BytesN<32> = BytesN::from_array(&env, &[11u8; 32]);
        client.submit_event(
            &admin,
            &EventInput {
                contract_id: cid,
                function: symbol_short!("ping"),
                ledger: 1u32,
                description: String::from_str(&env, "self transfer test"),
                raw_topics: Vec::new(&env),
                raw_data: Bytes::new(&env),
            },
        );
        assert_eq!(client.event_count(), 1u64);
    }

    // ── Input-size limits (anti-bloat DoS protection) ─────────────────────────

    fn make_string(env: &Env, len: usize) -> String {
        // Build a soroban_sdk::String of `len` 'a' bytes.
        // String::from_bytes takes &[u8]; we assemble it from a static block.
        // The largest len we ever call this with in tests is MAX_DESCRIPTION_LEN+1 = 513,
        // so a 1024-byte static block is sufficient.
        const BLOCK: &[u8] = &[b'a'; 1024];
        String::from_bytes(env, &BLOCK[..len.min(1024)])
    }

    // MAX_NAME_LEN = 64 ────────────────────────────────────────────────────────

    #[test]
    fn test_name_at_limit_succeeds() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[60u8; 32]);
        let meta = ContractMeta {
            name: make_string(&env, MAX_NAME_LEN as usize),
            ..make_meta(&env, "", &admin)
        };
        client.register_contract(&admin, &cid, &meta);
        assert_eq!(client.get_contract(&cid).name, meta.name);
    }

    #[test]
    #[should_panic]
    fn test_name_over_limit_rejected() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[61u8; 32]);
        let meta = ContractMeta {
            name: make_string(&env, (MAX_NAME_LEN + 1) as usize),
            ..make_meta(&env, "", &admin)
        };
        client.register_contract(&admin, &cid, &meta);
    }

    // MAX_DESCRIPTION_LEN = 512 ───────────────────────────────────────────────

    #[test]
    fn test_description_at_limit_succeeds() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[62u8; 32]);
        let meta = ContractMeta {
            description: make_string(&env, MAX_DESCRIPTION_LEN as usize),
            ..make_meta(&env, "Ok", &admin)
        };
        client.register_contract(&admin, &cid, &meta);
    }

    #[test]
    #[should_panic]
    fn test_description_over_limit_rejected() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[63u8; 32]);
        let meta = ContractMeta {
            description: make_string(&env, (MAX_DESCRIPTION_LEN + 1) as usize),
            ..make_meta(&env, "Over", &admin)
        };
        client.register_contract(&admin, &cid, &meta);
    }

    // MAX_FUNCTIONS = 50 ──────────────────────────────────────────────────────

    fn make_function(env: &Env) -> FunctionAbi {
        FunctionAbi {
            name: symbol_short!("fn"),
            description: String::from_str(env, "d"),
            params: Vec::new(env),
        }
    }

    #[test]
    fn test_functions_at_limit_succeeds() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[64u8; 32]);
        let mut fns: Vec<FunctionAbi> = Vec::new(&env);
        for _ in 0..MAX_FUNCTIONS {
            fns.push_back(make_function(&env));
        }
        let meta = ContractMeta {
            functions: fns,
            ..make_meta(&env, "FnLimit", &admin)
        };
        client.register_contract(&admin, &cid, &meta);
    }

    #[test]
    #[should_panic]
    fn test_functions_over_limit_rejected() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[65u8; 32]);
        let mut fns: Vec<FunctionAbi> = Vec::new(&env);
        for _ in 0..(MAX_FUNCTIONS + 1) {
            fns.push_back(make_function(&env));
        }
        let meta = ContractMeta {
            functions: fns,
            ..make_meta(&env, "FnOver", &admin)
        };
        client.register_contract(&admin, &cid, &meta);
    }

    // MAX_PARAMS_PER_FUNCTION = 20 ────────────────────────────────────────────

    fn make_param() -> ParamDef {
        ParamDef {
            name: symbol_short!("p"),
            kind: symbol_short!("u32"),
        }
    }

    #[test]
    fn test_params_at_limit_succeeds() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[66u8; 32]);
        let mut params: Vec<ParamDef> = Vec::new(&env);
        for _ in 0..MAX_PARAMS_PER_FUNCTION {
            params.push_back(make_param());
        }
        let mut fns: Vec<FunctionAbi> = Vec::new(&env);
        fns.push_back(FunctionAbi {
            name: symbol_short!("fn"),
            description: String::from_str(&env, "d"),
            params,
        });
        let meta = ContractMeta {
            functions: fns,
            ..make_meta(&env, "ParamLimit", &admin)
        };
        client.register_contract(&admin, &cid, &meta);
    }

    #[test]
    #[should_panic]
    fn test_params_over_limit_rejected() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[67u8; 32]);
        let mut params: Vec<ParamDef> = Vec::new(&env);
        for _ in 0..(MAX_PARAMS_PER_FUNCTION + 1) {
            params.push_back(make_param());
        }
        let mut fns: Vec<FunctionAbi> = Vec::new(&env);
        fns.push_back(FunctionAbi {
            name: symbol_short!("fn"),
            description: String::from_str(&env, "d"),
            params,
        });
        let meta = ContractMeta {
            functions: fns,
            ..make_meta(&env, "ParamOver", &admin)
        };
        client.register_contract(&admin, &cid, &meta);
    }

    // MAX_PARAM_NAME_LEN / MAX_PARAM_KIND_LEN = 32 ────────────────────────────
    // ParamDef.name/.kind are Soroban `Symbol`s, which the SDK itself refuses
    // to construct above 32 characters, so the reject path is enforced at
    // construction time rather than in `validate_meta`. These tests confirm
    // the accept path holds exactly at the limit.

    #[test]
    fn test_param_name_and_kind_at_limit_succeeds() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[71u8; 32]);
        let long_symbol = Symbol::new(&env, "abcdefghijklmnopqrstuvwxyz012345");
        let mut params: Vec<ParamDef> = Vec::new(&env);
        params.push_back(ParamDef {
            name: long_symbol.clone(),
            kind: long_symbol,
        });
        let mut fns: Vec<FunctionAbi> = Vec::new(&env);
        fns.push_back(FunctionAbi {
            name: symbol_short!("fn"),
            description: String::from_str(&env, "d"),
            params,
        });
        let meta = ContractMeta {
            functions: fns,
            ..make_meta(&env, "ParamNameKindLimit", &admin)
        };
        client.register_contract(&admin, &cid, &meta);
    }

    // Event description limit ─────────────────────────────────────────────────

    #[test]
    fn test_event_description_at_limit_succeeds() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[68u8; 32]);
        client.submit_event(
            &admin,
            &EventInput {
                contract_id: cid,
                function: symbol_short!("ev"),
                ledger: 1u32,
                description: make_string(&env, MAX_DESCRIPTION_LEN as usize),
                raw_topics: Vec::new(&env),
                raw_data: Bytes::new(&env),
            },
        );
        assert_eq!(client.event_count(), 1u64);
    }

    #[test]
    #[should_panic]
    fn test_event_description_over_limit_rejected() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[69u8; 32]);
        client.submit_event(
            &admin,
            &EventInput {
                contract_id: cid,
                function: symbol_short!("ev"),
                ledger: 1u32,
                description: make_string(&env, (MAX_DESCRIPTION_LEN + 1) as usize),
                raw_topics: Vec::new(&env),
                raw_data: Bytes::new(&env),
            },
        );
    }

    // update_contract also validates ──────────────────────────────────────────

    #[test]
    #[should_panic]
    fn test_update_contract_description_over_limit_rejected() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.init(&admin, &0u32);

        let cid: BytesN<32> = BytesN::from_array(&env, &[70u8; 32]);
        let meta_v0 = make_meta(&env, "MyApp", &admin);
        client.register_contract(&admin, &cid, &meta_v0);

        let meta_v1 = ContractMeta {
            abi_version: 1,
            description: make_string(&env, (MAX_DESCRIPTION_LEN + 1) as usize),
            ..meta_v0
        };
        client.update_contract(&admin, &cid, &meta_v1);
    }
}
