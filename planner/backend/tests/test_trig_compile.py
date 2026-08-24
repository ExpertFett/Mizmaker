"""Runtime-trig compilation for appended inline trigger rules.

DCS executes triggers from the compiled mission["trig"] tables, not from
trigrules (which is Mission-Editor display only). Proven live on the
dedicated server 2026-08-23: a trigrules-only rule never fires. These tests
pin the fix — append_inline_rules must compile every placed rule into
trig.conditions/actions/func/flag at the same index.
"""

import re

import pytest

from services.trigger_editor import append_inline_rules


FIXTURE = '''mission =
{
\t["trig"] =
\t{
\t\t["actions"] =
\t\t{
\t\t\t[1] = "a_do_script(\\"x\\"); mission.trig.func[1]=nil;",
\t\t}, -- end of ["actions"]
\t\t["events"] = {},
\t\t["func"] =
\t\t{
\t\t\t[1] = "if mission.trig.conditions[1]() then mission.trig.actions[1]() end",
\t\t}, -- end of ["func"]
\t\t["flag"] =
\t\t{
\t\t\t[1] = true,
\t\t}, -- end of ["flag"]
\t\t["conditions"] =
\t\t{
\t\t\t[1] = "return(c_time_after(4) )",
\t\t}, -- end of ["conditions"]
\t\t["funcStartup"] = {},
\t}, -- end of ["trig"]
\t["trigrules"] =
\t{
\t\t[1] =
\t\t{
\t\t\t["rules"] =
\t\t\t{
\t\t\t\t[1] = {
\t\t\t\t\t["seconds"] = 4,
\t\t\t\t\t["predicate"] = "c_time_after",
\t\t\t\t},
\t\t\t}, -- end of ["rules"]
\t\t\t["comment"] = "existing rule",
\t\t\t["eventlist"] = "",
\t\t\t["predicate"] = "triggerOnce",
\t\t\t["actions"] =
\t\t\t{
\t\t\t\t[1] = {
\t\t\t\t\t["text"] = "x",
\t\t\t\t\t["predicate"] = "a_do_script",
\t\t\t\t},
\t\t\t}, -- end of ["actions"]
\t\t}, -- end of [1]
\t}, -- end of ["trigrules"]
}
'''

FLAG_RULE = {
    "name": "flag probe",
    "eventType": "once",
    "conditions": [{"type": "TIME_MORE_THAN", "params": {"seconds": 60}}],
    "actions": [{"type": "SET_FLAG", "params": {"flag": "7777", "value": True}}],
}


def _trig_block(text):
    m = re.search(r'\["trig"\]\s*=\s*\n?\s*\{', text)
    depth = 0
    start = text.index("{", m.start())
    for j in range(start, len(text)):
        if text[j] == "{":
            depth += 1
        elif text[j] == "}":
            depth -= 1
            if depth == 0:
                return text[start:j + 1]
    raise AssertionError("unbalanced trig block")


def test_appended_rule_lands_in_trigrules_and_trig():
    out = append_inline_rules(FIXTURE, [FLAG_RULE])
    # trigrules got rule 2
    assert '["comment"] = "flag probe"' in out
    trig = _trig_block(out)
    # ...and the runtime tables got the compiled twin at the same index
    assert '[2] = "return(c_time_after(60) )"' in trig
    assert 'a_set_flag(\\"7777\\"); mission.trig.func[2]=nil;' in trig
    assert '[2] = "if mission.trig.conditions[2]() then mission.trig.actions[2]() end"' in trig
    # flag table enables the rule
    fm = re.search(r'\["flag"\][\s\S]*?\[2\] = true', trig)
    assert fm, "trig.flag[2] missing"


def test_message_rule_compiles_out_text():
    rule = {
        "name": "msg", "eventType": "once",
        "conditions": [{"type": "TIME_MORE_THAN", "params": {"seconds": 600}}],
        "actions": [{"type": "MESSAGE_TO_ALL",
                     "params": {"text": 'Say "hi"', "duration": 10}}],
    }
    out = append_inline_rules(FIXTURE, [rule])
    trig = _trig_block(out)
    # quotes inside the message escape one level deeper in the compiled string
    assert 'a_out_text_delay(\\"Say \\\\\\"hi\\\\\\"\\", 10, false, 0);' in trig


def test_continuous_rule_has_no_self_disarm():
    rule = {
        "name": "cont", "eventType": "continuous",
        "conditions": [{"type": "FLAG_IS_TRUE", "params": {"flag": "5"}}],
        "actions": [{"type": "CLEAR_FLAG", "params": {"flag": "6"}}],
    }
    out = append_inline_rules(FIXTURE, [rule])
    trig = _trig_block(out)
    assert '[2] = "return(c_flag_is_true(\\"5\\") )"' in trig
    assert "mission.trig.func[2]=nil" not in trig


def test_start_rule_expands_empty_funcStartup():
    rule = {
        "name": "start", "eventType": "onMissionStart",
        "conditions": [],
        "actions": [{"type": "SET_FLAG", "params": {"flag": "9", "value": True}}],
    }
    out = append_inline_rules(FIXTURE, [rule])
    trig = _trig_block(out)
    fs = re.search(r'\["funcStartup"\]\s*=\s*\{[\s\S]*?\}', trig)
    assert fs and "[2] =" in fs.group(0), "funcStartup entry missing"
    # no conditions -> always-true condition
    assert '[2] = "return(true )"' in trig


def test_replaced_rule_recompiles_trig_at_same_index():
    # first add, then upsert the same name with a different flag value
    out = append_inline_rules(FIXTURE, [FLAG_RULE])
    changed = dict(FLAG_RULE)
    changed["actions"] = [{"type": "SET_FLAG", "params": {"flag": "8888", "value": True}}]
    out2 = append_inline_rules(out, [changed])
    trig = _trig_block(out2)
    assert 'a_set_flag(\\"8888\\")' in trig
    assert 'a_set_flag(\\"7777\\")' not in trig
    # still exactly one rule 2 entry per table
    assert len(re.findall(r'\[2\] = "return\(', trig)) == 1


def test_output_is_valid_lua():
    pytest.importorskip("ctypes")
    import ctypes, os
    dll = r"C:\Program Files\Eagle Dynamics\DCS World\bin\lua5.1.dll"
    if not os.path.exists(dll):
        pytest.skip("DCS lua5.1.dll not available")
    out = append_inline_rules(FIXTURE, [FLAG_RULE])
    lua = ctypes.CDLL(dll)
    lua.luaL_newstate.restype = ctypes.c_void_p
    lua.luaL_loadstring.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
    assert lua.luaL_loadstring(lua.luaL_newstate(), out.encode()) == 0
