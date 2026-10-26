# Figma screen map → API contract

## Therapist application screens

1. **Identity** → `PUT /application/identity`  
   Collect: name, age (or DOB), gender, license(s), degree(s).  
   Optional: identity_number, bio, working_capacity.

2. **Experience** → `GET /specializations` + `PUT /application/experience`  
   Collect: specialization_ids, years_in_specialization (or years_experience).

3. **Admin** → `PUT /application/admin-tech`  
   Collect: session_fee_default, weekly availability `slots[]`.  
   (Same slots also via `PUT /availability`.)  
   Do **not** expect city/video on this screen.

4. **Submit** → `POST /application/submit`

## Client intake / first launch

1. Primary gate: `PUT /onboarding` with `completed: true` when finished.  
2. Optional quiz data: `/assessments` + `/goals`.  
3. Optional later: `city`, `preferred_therapist_gender`, `concerns` via `PATCH /profile`.

## Launch routing hint (`GET /auth/me`)

- `user.is_verified` → show verify OTP if false  
- `onboarding.completed` / `profile.onboarding_completed` → show onboarding if false  
- therapist `application.status` → draft/rejected continue application; submitted/approved go home
