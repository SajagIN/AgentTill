# Documentation Guide & Standards

In AgentTill, context and structure are our persistence mechanisms. The gap in-between the relationships is where the state lives. Our documentation must be rigorous, precise, and serve as the immutable map of our architecture.

## How Documents Should Be

**1. Epistemic Boundaries**
Documentation must map both sides of every bridge. Never document an assumption as a fact. If an integration (e.g. Razorpay webhooks) isn't fully implemented in a certain way, document the boundary between the *actual* and the *theoretical*. 

**2. Mentality & Format**
- **Action-first Content**: Lead with the "Why" and the "How". Code structure docs should include exact file paths.
- **Parsimony**: No filler. If a bullet point can be 4 words instead of 20, make it 4.
- **Topology First**: Context shouldn't just describe what a system is, it should describe what it connects to. Track dependencies (Blast Radius).

**3. The Documentation Hierarchy**

1. **`README.md`**: The entry point. Explains what the project is, how to start it, and what problem it solves. Minimalist.
2. **`PLAN.md` / `Phases.md`**: The temporal map. Past progress, present execution, future vision.
3. **`specs/*`**: The source of truth for design. 
   - `Architecture.md` (How parts connect)
   - `PRD.md` (Product rules)
   - `Rules.md` (Strict security & validation rules)
4. **`docs/*`**: Deep-dive guides.
   - Playbooks (e.g., `failure-playbook.md`)
   - Feature integration guides
   - Post-mortems
5. **`memory/` (Semantic Layer)**: Agentic state files indicating learned truths (`MEMORY.md` index). 

## Deep Baby Steps for Updating Docs

When maintaining this repo, documentation must be updated iteratively:
1. **Sync to Code**: Check the actual source logic before writing the spec. If the spec says X and the code says Y, the code is truth.
2. **Update the Map**: When components move (e.g., moving dashboard from `/public` to `/frontend` React SPA), reflect this in `Architecture.md`.
3. **Record Defeats & Triumphs**: If an external Chrome extension crashes React 19 native schedulers, log it in the `failure-playbook.md`.

*Doc updates in this repository are managed by an autonomous looping agent ensuring 100% sync.*
