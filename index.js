import * as core from '@actions/core';
import * as github from '@actions/github';
import cherry from 'github-cherry-pick';
import { runAction } from './lib/action.js';

runAction({
  core,
  github,
  cherryPickCommits: cherry.cherryPickCommits
});
