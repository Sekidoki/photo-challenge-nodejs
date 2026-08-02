import assert from "node:assert/strict";
import { test } from "../support/harness.js";
import { isCommonsLoginError, toUserFacingCommonsErrorMessage } from "../../src/services/commons-bot.js";

test("isCommonsLoginError detects wrapped Wikimedia credential failures", () => {
  const error = new Error([
    "Unable to log in to Wikimedia Commons with the provided credentials.",
    "Tried usernames:",
    "- Example@Bot"
  ].join("\n"));

  assert.equal(isCommonsLoginError(error), true);
  assert.equal(
    toUserFacingCommonsErrorMessage(error),
    "Incorrect username or bot password. Update the saved sign-in and try again."
  );
});

test("toUserFacingCommonsErrorMessage falls back to the original error message for non-login errors", () => {
  const error = new Error("Page does not exist: Example");
  assert.equal(isCommonsLoginError(error), false);
  assert.equal(toUserFacingCommonsErrorMessage(error), "Page does not exist: Example");
});

test("OAuth authentication failures ask the maintainer to sign in again", () => {
  const error = new Error("Unable to authenticate with Wikimedia OAuth: invalid access token");
  assert.equal(isCommonsLoginError(error), true);
  assert.equal(
    toUserFacingCommonsErrorMessage(error),
    "Your Wikimedia sign-in expired or is no longer authorized. Sign in again and retry."
  );
});
