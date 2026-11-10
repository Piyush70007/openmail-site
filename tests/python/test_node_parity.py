"""Run identical synthetic AI-platform fixtures against both implementations."""
import json
from pathlib import Path
import subprocess
import unittest

from backend.ai_platform import evaluate_simulation, feedback_allowed, workflow_matches


ROOT = Path(__file__).resolve().parents[2]
BASELINE = ROOT / 'tests/node_baseline/server/ai-platform.js'


class NodePlatformParityTests(unittest.TestCase):
    def test_platform_behavior_matches_node_baseline(self):
        fixtures = []
        for expected in ('auto_reply', 'human_review', '', 'unsupported'):
            for actual in ('auto_reply', 'human_review', '', 'unsupported'):
                for confidence in (None, 0, .79, .8, .99, 1, '0.80', 'invalid'):
                    decision = {'decision': actual, 'confidence': confidence,
                                'evidenceValidated': True, 'citations': [{'source_id': 'hours'}]}
                    fixtures.append({'kind': 'evaluation', 'args': [expected, decision]})
        for changes in ({'evidenceValidated': False}, {'citations': []}, {'citations': None}, {'evidenceValidated': None}):
            decision = {'decision': 'auto_reply', 'confidence': .95,
                        'evidenceValidated': True, 'citations': [{'source_id': 'hours'}], **changes}
            fixtures.append({'kind': 'evaluation', 'args': ['auto_reply', decision]})
        fixtures.append({'kind': 'evaluation', 'args': ['human_review', None]})
        for status in ('auto_sent', 'draft_created', 'human_review', 'failed', 'workflow_applied', 'ignored', 'processing', ''):
            for outcome in ('correct', 'correction', 'resolved', 'escalated'):
                fixtures.append({'kind': 'feedback', 'args': [status, outcome]})
        messages = [
            {'subject': 'INVOICE request', 'text_body': 'Can you help?'},
            {'subject': 'Question', 'text_body': 'Where is my invoice?'},
            {'subject': 'ＩＮＶＯＩＣＥ', 'text_body': 'Compatibility text'},
            {'subject': 'Office\n\t hours', 'text_body': 'When are you open?'},
            {'subject': 'Opening hours', 'text_body': 'No keyword match here.'},
            {}, None,
        ]
        for mode in ('all_inbound', 'contains_any'):
            for enabled in (True, False):
                for terms in (['invoice'], ['refund', 'office hours'], [], [' '], None):
                    rule = {'enabled': enabled, 'trigger_mode': mode, 'match_terms': terms}
                    for message in messages:
                        fixtures.append({'kind': 'workflow', 'args': [rule, message]})
        fixtures.append({'kind': 'workflow', 'args': [None, {'subject': 'Invoice'}]})
        script = """
const fs = require('node:fs');
const platform = require(process.argv[1]);
const functions = { evaluation: platform.evaluateSimulation,
  feedback: platform.feedbackAllowed, workflow: platform.workflowMatches };
const fixtures = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(fixtures.map(item => functions[item.kind](...item.args))));
"""
        completed = subprocess.run(['node', '-e', script, str(BASELINE)], cwd=ROOT,
                                   input=json.dumps(fixtures), text=True, capture_output=True, check=True)
        expected = json.loads(completed.stdout)
        functions = {'evaluation': evaluate_simulation, 'feedback': feedback_allowed, 'workflow': workflow_matches}
        self.assertEqual(len(expected), len(fixtures))
        for fixture, result in zip(fixtures, expected):
            with self.subTest(fixture=fixture):
                self.assertEqual(functions[fixture['kind']](*fixture['args']), result)


if __name__ == '__main__':
    unittest.main()
