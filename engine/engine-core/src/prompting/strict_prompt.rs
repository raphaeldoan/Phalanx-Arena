use super::*;

pub(crate) const STRICT_PROMPT_PROFILE: &str = "strict";
pub(crate) const STRICT_BENCHMARK_ACTION_HISTORY_LIMIT: usize = 3;

pub fn build_user_prompt(
    snapshot: &GameSnapshot,
    request: &AiTurnRequest,
    action_catalog: &[ActionCatalogEntry],
    action_history: &[Action],
    prompt_profile: Option<&str>,
) -> String {
    let is_strict_prompt =
        normalize_prompt_profile(prompt_profile.unwrap_or("")) == Some(STRICT_PROMPT_PROFILE);
    if is_strict_prompt {
        return build_strict_user_prompt(snapshot, request, action_history);
    }

    let phase_instruction = build_phase_instruction(&snapshot.state);
    let choice_instruction = if request.deployment_batch {
        "Return deployment placements for the active army."
    } else if request.battle_batch {
        "Return an ordered list of semantic order objects for the active army's whole bound; omit end_bound because the harness ends the bound after attempting the plan."
    } else {
        "Choose one legal action index for the active player."
    };
    let mut lines = vec![
        format!("Command army: {}", request.army),
        choice_instruction.to_string(),
        build_intent_line(request),
        "Source of truth: compact exact current state + exact action history + last action result + immediate action effects + legal actions JSON."
            .to_string(),
        "Legend: U <id> <army> <kind> @x,y <facing> L<0/1> F<o/c> Q<i/o/s> C<0/1 current-command> D<0/1> V<0/1> A<0/1> CH<0/1> X<0/1> UC=<class> FS=<formation> PC=<pursuit> MV=<morale>."
            .to_string(),
        "Legend: ARMY <army> morale=<loss>/<threshold> shaken=<0/1> broken=<0/1>; SCORE mirrors enemy morale loss for compatibility; META cmd=<A:n,B:n> gives current command radii and endgame=<bound|-> marks the optional endgame deadline; ZONE = deployment zone; ACT = exact applied action; LAST = explicit result of the most recent applied action; EFF = immediate deterministic action effect; RES = recent combat; EVT = recent event."
            .to_string(),
        "Legend: PROFILE <kind> mv=<n> march=<+n> close=<foot>/<mounted> msl=<range>/<attack|-> mdef=<n> sup=<0/1> pur=<n> mounted=<0/1> scr=<n> pass=<comma-list|->."
            .to_string(),
        String::new(),
        "Unit profiles by kind:".to_string(),
        build_compact_unit_profiles(&snapshot.state.units),
        String::new(),
        "Current state compact:".to_string(),
        build_compact_state(&snapshot.state),
        String::new(),
        "Exact action history compact:".to_string(),
        build_compact_action_history(action_history),
        String::new(),
        "Last action result:".to_string(),
        build_last_action_result(&snapshot.state, action_history),
        String::new(),
        "Immediate action effects by index:".to_string(),
        build_immediate_action_effects(&snapshot.state, &snapshot.legal_actions),
    ];
    if !phase_instruction.is_empty() {
        lines.insert(5, phase_instruction);
    }
    lines.extend([
        String::new(),
        "Recent resolution tail:".to_string(),
        build_compact_resolution_tail(&snapshot.state.recent_resolutions),
        String::new(),
        "Recent event tail:".to_string(),
        build_compact_event_tail(&snapshot.state.log),
    ]);
    lines.extend([
        String::new(),
        "Legal actions JSON:".to_string(),
        action_catalog_json_for_prompt(action_catalog, false),
    ]);
    lines.join("\n")
}

pub(crate) fn build_strict_user_prompt(
    snapshot: &GameSnapshot,
    request: &AiTurnRequest,
    action_history: &[Action],
) -> String {
    let decision_line = if request.deployment_batch {
        "Return placements for this army in one response."
    } else if request.battle_batch {
        "Return ordered semantic order objects for this army's whole bound from GROUPED_ACTIONS. Do not include END; the harness ends the bound after attempting the plan. Use SELF/ENEMY ids and local x,y/facing exactly as shown. Use null or [] for fields that do not apply. Prefer at most one order per unit."
    } else {
        "Pick one legal action index for the active player."
    };
    [
        format!(
            "CMD army=SELF mode={} view=local",
            if request.deployment_batch {
                "deployment_batch"
            } else if request.battle_batch {
                "bound_plan"
            } else {
                "action"
            }
        ),
        decision_line.to_string(),
        build_strict_intent_line(request),
        build_strict_legend_line(request),
        "STATE".to_string(),
        build_short_dynamic_state_perspective(&snapshot.state, &request.army),
        "HIST".to_string(),
        build_compact_action_history_tail_perspective(
            &snapshot.state,
            &request.army,
            action_history,
        ),
        "LAST".to_string(),
        build_last_action_result_perspective(&snapshot.state, &request.army, action_history),
        if request.deployment_batch {
            "DEPLOY".to_string()
        } else if request.battle_batch {
            "GROUPED_ACTIONS".to_string()
        } else {
            "ACTIONS".to_string()
        },
        if request.deployment_batch {
            build_deployment_option_lines_perspective(
                &snapshot.state,
                &request.army,
                &snapshot.legal_actions,
            )
        } else {
            build_legal_action_lines_perspective(
                &snapshot.state,
                &request.army,
                &snapshot.legal_actions,
            )
        },
    ]
    .join("\n")
}

pub(crate) fn build_intent_line(request: &AiTurnRequest) -> String {
    let current = if request.current_intent.trim().is_empty() {
        "-".to_string()
    } else {
        compact_text(request.current_intent.as_str())
    };
    let update = if request.can_update_intent {
        "allowed"
    } else {
        "locked"
    };
    format!("Intent memory: current={current}; update={update}; `intent_update` replaces it, empty keeps it.")
}

pub(crate) fn build_strict_intent_line(request: &AiTurnRequest) -> String {
    let current = if request.current_intent.trim().is_empty() {
        "-".to_string()
    } else {
        compact_text(request.current_intent.as_str())
    };
    let update = if request.can_update_intent { "1" } else { "0" };
    format!("I cur={current} upd={update} fmt=short")
}

pub(crate) fn build_strict_legend_line(request: &AiTurnRequest) -> String {
    if request.deployment_batch {
        return "LEG local view: SELF always advances toward lower y; unit ids use SELF-/ENEMY- aliases. U=id kind xyF flags; ldr leader qs/qi quality ooc out-command dis disorder act activated op ordered-pike res reserve. DUNITS lists units; DCELLS/DOPT list legal local cells. Return unique legal SELF placements only."
            .to_string();
    }
    if request.battle_batch {
        return "LEG local view: SELF always advances toward lower y; unit ids use SELF-/ENEMY- aliases. U=id kind xyF flags; ldr leader qs/qi quality ooc out-command dis disorder act activated chg charging op ordered-pike. Units in enemy contact are in combat; no ordinary orders except fresh light-troop break-off moves shown in ACT. ACT END idx; G/GM group move/march; M/MM unit cP idx:xyF; R rotate; CH charge; SH queue shoot/end-bound; RA rally; RP reform. Return ordered shown original idx values only, excluding END."
            .to_string();
    }
    "LEG local view: SELF always advances toward lower y; unit ids use SELF-/ENEMY- aliases. U=id kind xyF flags; ldr leader qs/qi quality ooc out-command dis disorder act activated chg charging op ordered-pike. Units in enemy contact are in combat; no ordinary orders except fresh light-troop break-off moves shown in ACT. ACT END idx; G/GM group move/march; M/MM unit cP idx:xyF; R rotate; CH charge; SH queue shoot/end-bound; RA rally; RP reform. Choose one shown original idx only."
        .to_string()
}

pub(crate) fn build_phase_instruction(state: &crate::types::GameState) -> String {
    if state.phase != GamePhase::Deployment {
        return String::new();
    }
    "Deployment reminder: every unit must receive a legal `deploy` action inside its deployment zone before `finalize_deployment` becomes legal; displayed PIPs do not restrict deployment."
        .to_string()
}

pub(crate) fn normalize_prompt_profile(prompt_profile: &str) -> Option<&'static str> {
    let normalized = prompt_profile.trim();
    if normalized.is_empty() {
        return None;
    }
    if normalized.eq_ignore_ascii_case(STRICT_PROMPT_PROFILE) {
        return Some(STRICT_PROMPT_PROFILE);
    }
    None
}
