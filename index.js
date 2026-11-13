import * as core from '@actions/core';
import * as github from '@actions/github';
import { runAction } from './lib/action.js';
import { cherryPickCommits } from './lib/cherry-pick.js';

runAction({
  core,
  github,
  cherryPickCommits
});
