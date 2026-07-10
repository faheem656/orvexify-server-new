// src/utils/defaultTemplates.js

const defaultTemplates = {
  reminder: {
    subject: 'Appointment Reminder: {{clinic_name}} - {{appointment_date}}',
    body: `Dear {{patient_name}},

This is a reminder for your upcoming appointment at {{clinic_name}}.

Date: {{appointment_date}}
Time: {{appointment_time}}
Doctor: {{doctor_name}}

Please confirm your attendance:
Confirm: {{confirm_link}}
Cancel: {{cancel_link}}

Thank you,
{{clinic_name}}`
  },
  confirmation: {
    subject: 'Appointment Confirmed - {{clinic_name}}',
    body: `Dear {{patient_name}},

Your appointment has been confirmed.

Date: {{appointment_date}}
Time: {{appointment_time}}
Doctor: {{doctor_name}}

We look forward to seeing you.

Thank you,
{{clinic_name}}`
  },
  cancellation: {
    subject: 'Appointment Cancelled - {{clinic_name}}',
    body: `Dear {{patient_name}},

Your appointment has been cancelled as requested.

Date: {{appointment_date}}
Time: {{appointment_time}}

Please contact us if you wish to reschedule.

Thank you,
{{clinic_name}}`
  }
};

module.exports = defaultTemplates;