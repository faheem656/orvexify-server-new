/**
 * DROP-IN: src/utils/defaultTemplates.js
 * Placeholders: {{clinic_name}} {{patient_name}} {{doctor_name}}
 * {{appointment_date}} {{appointment_time}} {{confirm_link}} {{cancel_link}}
 * Email only. No SMS.
 */

const reminder = {
  subject: 'Reminder: {{clinic_name}} — {{appointment_date}} at {{appointment_time}}',
  body: `Hi {{patient_name}},

This is a reminder for your appointment at {{clinic_name}}.

Doctor: {{doctor_name}}
Date: {{appointment_date}}
Time: {{appointment_time}}

Confirm: {{confirm_link}}
Cancel: {{cancel_link}}

We also email at 24 hours, 2 hours and 30 minutes before the visit.

— {{clinic_name}}`,
};

const confirmation = {
  subject: 'Appointment confirmed — {{clinic_name}}',
  body: `Hi {{patient_name}},

Your appointment is confirmed.

Clinic: {{clinic_name}}
Doctor: {{doctor_name}}
Date: {{appointment_date}}
Time: {{appointment_time}}

If you cannot make it, cancel here: {{cancel_link}}

— {{clinic_name}}`,
};

const cancellation = {
  subject: 'Appointment cancelled — {{clinic_name}}',
  body: `Hi {{patient_name}},

Your appointment at {{clinic_name}} has been cancelled.

Doctor: {{doctor_name}}
Date: {{appointment_date}}
Time: {{appointment_time}}

Reply to this email if you want to book again.

— {{clinic_name}}`,
};

module.exports = {
  reminder,
  confirmation,
  cancellation,
};
