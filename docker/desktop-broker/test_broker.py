import unittest
from unittest.mock import patch
from broker import command

class BrokerTests(unittest.TestCase):
 def setUp(self):
  self.config={"image":"desktop@sha256:fixed","host":"172.17.0.1","boot":["sh","-c","fixed boot"]}
 def test_rejects_host_operations(self):
  for args in [["build","."],["exec","api","cat","/etc/shadow"],["inspect","--format","{{json .Config.Env}}","api"],["network","rm","default"],["run","--name","api"]]:
   with self.subTest(args=args),self.assertRaises(ValueError): command(args,self.config)
 def test_reconstructs_run_without_client_privileges(self):
  result=command(["run","--name","oddjob-desktop-org-1","--privileged","-v","/:/host","evil-image"],self.config)
  self.assertNotIn("--privileged",result)
  self.assertNotIn("/:/host",result)
  self.assertNotIn("evil-image",result)
  self.assertIn("oddjob-desktop-org-1-home:/home/cua",result)
  self.assertIn(self.config["image"],result)
  self.assertIn("172.17.0.1::6901",result)
 def test_refuses_wrong_owner(self):
  with patch("broker.run") as run:
   run.return_value.returncode=0;run.return_value.stdout="other-workload"
   with self.assertRaises(ValueError): command(["start","oddjob-desktop-org-1"],self.config)
 def test_allows_only_named_ports(self):
  with self.assertRaises(ValueError):command(["port","oddjob-desktop-org-1","5000/tcp"],self.config)
 def test_refuses_image_changes(self):
  with self.assertRaises(ValueError):command(["image","inspect","other"],self.config)
if __name__=="__main__":unittest.main()
