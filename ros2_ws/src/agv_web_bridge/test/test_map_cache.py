"""Saved real maps survive restart only when their geometry and files match."""
import json
import math
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from agv_web_bridge.map_cache import cached_parameters, geometry_digest


class MapCacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.manifest = self.root/'warehouse.json'
        self.config = {'rack_structure': {'length': 24}}
        self.item = {'geometry': geometry_digest(self.config), 'snapshot': 'snapshot-1', 'world_to_map': [10, 20, math.pi/2]}
        for suffix in ('.posegraph', '.data'): (self.root/f'snapshot-1{suffix}').write_bytes(b'test file')
    def write(self): self.manifest.write_text(json.dumps(self.item))
    def test_no_checkpoint_starts_fresh_mapping(self):
        self.assertEqual(cached_parameters(self.manifest,self.config,(0,0,0)),{})
    def test_restores_graph_at_the_actual_spawn_in_map_coordinates(self):
        self.write(); params=cached_parameters(self.manifest,self.config,(2,3,.3))
        self.assertEqual(params['map_file_name'],str((self.root/'snapshot-1').resolve()))
        for actual,expected in zip(params['map_start_pose'],[7,22,math.pi/2+.3]):self.assertAlmostEqual(actual,expected)
        self.assertFalse(params['map_start_at_dock'])
    def test_changed_geometry_cannot_restore_old_free_space(self):
        self.write()
        with self.assertRaisesRegex(ValueError,'geometry differs'):cached_parameters(self.manifest,{'rack_structure': {'length':25}},(0,0,0))
    def test_incomplete_snapshot_is_rejected(self):
        self.write();(self.root/'snapshot-1.data').unlink()
        with self.assertRaisesRegex(ValueError,'incomplete'):cached_parameters(self.manifest,self.config,(0,0,0))
    def test_empty_graph_is_rejected(self):
        self.write();(self.root/'snapshot-1.posegraph').write_bytes(b'')
        with self.assertRaisesRegex(ValueError,'incomplete'):cached_parameters(self.manifest,self.config,(0,0,0))
    def test_malformed_manifest_and_transform_are_rejected(self):
        for value in [None, [], [0,0], [0,0,float('nan')], ['0',0,0]]:
            self.item['world_to_map']=value;self.write()
            with self.assertRaises(ValueError):cached_parameters(self.manifest,self.config,(0,0,0))
        self.manifest.write_text('[]')
        with self.assertRaises(ValueError):cached_parameters(self.manifest,self.config,(0,0,0))
    def test_snapshot_stays_inside_its_cache_directory(self):
        self.item['snapshot']='../other';self.write()
        with self.assertRaisesRegex(ValueError,'snapshot name'):cached_parameters(self.manifest,self.config,(0,0,0))
