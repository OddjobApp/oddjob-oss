import React from "react";
import ClientFormStudioPod, { type FormStudioPodProps } from "@/modules/forms/FormStudioPod";

/**
 * Form Studio: a form's structure, logic, results, tests and releases.
 *
 * Mounted beside a CREW room from the Scaffold rail, or standalone at
 * /armory/forms/builder/:id. Props match App Studio's rail contract, including
 * onFocusInChat for sending a selected field, page, rule or result to the room.
 */
export default function FormStudioPod(props: FormStudioPodProps) {
  return <ClientFormStudioPod {...props} />;
}
